// Real deps: Appwrite Server SDK + Gemini Files API + DeepSeek consolidator.
import { Client, Databases, Permission, Query, Role, Storage } from "node-appwrite";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  MAX_VISUAL_ANALYSIS_ATTEMPTS,
  visualAnalysisJobId,
  type VisualAnalysisJobStatusValue,
  type VisualAnalysisOutput,
} from "@merism/contracts";
import type { AnalyzeSessionVisualDeps, ClaimResult, TranscriptRecord } from "./handler.js";
import { decideClaim, type ExistingJob } from "./claim.js";
import {
  isVisualRecording,
  recordingMimeType,
  type RecordingRecord,
  type VisualAnalysisInput,
} from "./visual-analysis.js";
import {
  createGeminiVisualAnalyzer,
  geminiVisualConfigFromEnv,
} from "./gemini-visual-analyzer.js";
import { createDeepSeekConsolidator } from "./gemini/deepseek-consolidator.js";

const DB = "merism";
const COLLECTION = "visual_analysis_jobs";
// A non-terminal job not updated within this window is treated as crashed and re-claimable.
const STUCK_AFTER_MS = (() => {
  const v = Number.parseInt(process.env.GEMINI_VISUAL_STUCK_AFTER_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 15 * 60 * 1000;
})();

function req(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createRealDeps(): AnalyzeSessionVisualDeps {
  const endpoint = req("APPWRITE_ENDPOINT");
  const project = req("APPWRITE_PROJECT_ID");
  const apiKey = req("APPWRITE_API_KEY");
  const client = new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey);
  const db = new Databases(client);
  const storage = new Storage(client);

  const deepseek = createDeepSeek({
    apiKey: req("DEEPSEEK_API_KEY"),
    ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
  });
  const deepseekModel = deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
  const consolidator = createDeepSeekConsolidator({ model: deepseekModel });

  const config = geminiVisualConfigFromEnv(process.env);
  if (!config) {
    // createRealDeps must only be built when the feature is enabled (main.ts gates).
    throw new Error("GEMINI_VISUAL_ANALYSIS_ENABLED must be true to run analyzeSessionVisual");
  }

  const nowIso = () => new Date().toISOString();

  async function patchJobFile(sessionId: string, geminiFileName: string): Promise<void> {
    await db.updateDocument(DB, COLLECTION, visualAnalysisJobId(sessionId), {
      status: "uploading",
      geminiFileName,
      geminiUploadedAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return {
    now: () => Date.now(),

    async findJobContext(sessionId: string) {
      try {
        const session = (await db.getDocument(DB, "interview_sessions", sessionId)) as any;
        const survey = (await db.getDocument(DB, "surveys", session.surveyId)) as any;
        const projectDoc = (await db.getDocument(DB, "projects", survey.projectId)) as any;
        return { surveyId: session.surveyId, ownerUserId: projectDoc.ownerUserId };
      } catch (e: any) {
        if (e?.code === 404) return null;
        throw e;
      }
    },

    async claimJob({ sessionId, surveyId, ownerUserId, now }) {
      const id = visualAnalysisJobId(sessionId);
      const nowMs = Date.parse(now);
      const claimOpts = { nowMs, attemptCap: MAX_VISUAL_ANALYSIS_ATTEMPTS, stuckAfterMs: STUCK_AFTER_MS };

      const readExisting = async (): Promise<ExistingJob | null> => {
        try {
          const doc = (await db.getDocument(DB, COLLECTION, id)) as any;
          return {
            status: doc.status as VisualAnalysisJobStatusValue,
            attemptCount: doc.attemptCount ?? 0,
            updatedAtMs: Date.parse(doc.updatedAt ?? doc.$updatedAt ?? now) || nowMs,
          };
        } catch (e: any) {
          if (e?.code === 404) return null;
          throw e;
        }
      };

      const apply = async (decision: ReturnType<typeof decideClaim>): Promise<ClaimResult> => {
        if (decision.action === "create") {
          await db.createDocument(
            DB,
            COLLECTION,
            id,
            {
              sessionId,
              surveyId,
              ownerUserId,
              status: "analyzing",
              geminiFileName: null,
              geminiUploadedAt: null,
              attemptCount: decision.nextAttemptCount,
              createdAt: now,
              updatedAt: now,
            },
            [Permission.read(Role.user(ownerUserId))],
          );
          return { claimed: true, status: "analyzing" };
        }
        if (decision.action === "claim") {
          await db.updateDocument(DB, COLLECTION, id, {
            status: "analyzing",
            attemptCount: decision.nextAttemptCount,
            errorContext: null,
            updatedAt: now,
          });
          return { claimed: true, status: "analyzing" };
        }
        if (decision.action === "fail_permanent") {
          await db.updateDocument(DB, COLLECTION, id, {
            status: "failed",
            errorContext: JSON.stringify({ reason: "max_attempts_exceeded" }),
            updatedAt: now,
          });
          return { claimed: false, status: "failed" };
        }
        return { claimed: false, status: decision.status };
      };

      const decision = decideClaim(await readExisting(), claimOpts);
      if (decision.action === "create") {
        try {
          return await apply(decision);
        } catch (e: any) {
          if (e?.code !== 409) throw e;
          // Lost the create race — re-read and decide against the now-existing row.
          return apply(decideClaim(await readExisting(), claimOpts));
        }
      }
      return apply(decision);
    },

    async findRecording(sessionId: string): Promise<RecordingRecord | null> {
      const res = await db.listDocuments(DB, "recordings", [
        Query.equal("sessionId", sessionId),
        Query.limit(1),
      ]);
      const doc = res.documents[0] as any;
      if (!doc) return null;
      const recording: RecordingRecord = {
        $id: doc.$id,
        sessionId: doc.sessionId,
        ownerUserId: doc.ownerUserId,
        storageFileId: doc.storageFileId,
        durationMs: doc.durationMs,
        format: doc.format,
      };
      return isVisualRecording(recording) ? recording : null;
    },

    async findTranscript(sessionId: string): Promise<TranscriptRecord | null> {
      const res = await db.listDocuments(DB, "transcripts", [
        Query.equal("sessionId", sessionId),
        Query.orderDesc("finalizedAt"),
        Query.limit(1),
      ]);
      const doc = res.documents[0] as any;
      if (!doc) return null;
      return {
        $id: doc.$id,
        sessionId: doc.sessionId,
        segments: parseJson(doc.segments, []),
        language: doc.language,
      };
    },

    async getRecordingBytes(recording: RecordingRecord) {
      const buffer = await storage.getFileDownload("recordings", recording.storageFileId);
      return {
        bytes: new Uint8Array(buffer),
        mimeType: recordingMimeType(recording.format),
      };
    },

    // Per-invocation analyzer so the upload hook is bound to this session's job row.
    analyzeRecordingVisuals: (input: VisualAnalysisInput) =>
      createGeminiVisualAnalyzer({
        consolidator,
        config,
        hooks: { onFileUploaded: (name: string) => patchJobFile(input.sessionId, name) },
      })(input),

    async setJobStatus(sessionId, status, patch) {
      const payload: Record<string, unknown> = { status, updatedAt: nowIso() };
      if (patch?.errorContext !== undefined) {
        payload.errorContext = JSON.stringify(patch.errorContext);
      }
      await db.updateDocument(DB, COLLECTION, visualAnalysisJobId(sessionId), payload);
    },

    async patchReportVisualAnalysis(sessionId: string, visual: VisualAnalysisOutput) {
      const existing = await db.listDocuments(DB, "analysis_reports", [
        Query.equal("scope", "session"),
        Query.equal("sessionId", sessionId),
        Query.limit(1),
      ]);
      const doc = existing.documents[0] as any;
      if (!doc) {
        // The text report must exist first (analyzeSession runs before enqueue).
        // Absence is a real ordering bug — surface it so the job row records failure.
        throw new Error("analysis_report_not_found");
      }
      // `insights` is the historical JSON bucket carrying insights +
      // perQuestionSummary + visualAnalysis (see analyzeSession upsertSessionReport).
      const bucket = parseJson<Record<string, unknown>>(doc.insights, {});
      bucket.visualAnalysis = visual;
      await db.updateDocument(DB, "analysis_reports", doc.$id, {
        insights: JSON.stringify(bucket),
      });
    },
  };
}
