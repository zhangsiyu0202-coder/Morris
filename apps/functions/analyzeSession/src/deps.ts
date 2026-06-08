// Real deps: Appwrite Server SDK + DeepSeek via @ai-sdk/deepseek.
import { Client, Databases, ID, Permission, Query, Role, Storage } from "node-appwrite";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, Output } from "ai";
import {
  AnalysisReportOutputSchema,
  type AnalysisReportInput,
  type AnalysisReportOutput,
} from "@merism/contracts";
import type {
  AnalyzeSessionDeps,
  SessionRecord,
  SurveyContext,
  TranscriptRecord,
} from "./handler.js";
import {
  SESSION_ANALYZE_SYSTEM,
  buildSessionAnalyzeUserPrompt,
} from "./prompts/session-analyze.js";
import { createGeminiVisualAnalyzerFromEnv } from "./gemini-visual-analyzer.js";
import { createDeepSeekConsolidator } from "./gemini/deepseek-consolidator.js";
import { isVisualRecording, recordingMimeType, type RecordingRecord } from "./visual-analysis.js";

const DB = "merism";

interface Env {
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_ID: string;
  APPWRITE_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
}

function req(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function requireEnv(): Env {
  return {
    APPWRITE_ENDPOINT: req("APPWRITE_ENDPOINT"),
    APPWRITE_PROJECT_ID: req("APPWRITE_PROJECT_ID"),
    APPWRITE_API_KEY: req("APPWRITE_API_KEY"),
    DEEPSEEK_API_KEY: req("DEEPSEEK_API_KEY"),
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createRealDeps(): AnalyzeSessionDeps {
  const env = requireEnv();
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const db = new Databases(client);
  const storage = new Storage(client);
  const deepseek = createDeepSeek({
    apiKey: env.DEEPSEEK_API_KEY,
    ...(env.DEEPSEEK_BASE_URL ? { baseURL: env.DEEPSEEK_BASE_URL } : {}),
  });
  const modelName = env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const deepseekModel = deepseek(modelName);
  // Visual analyzer (PostHog-style: Gemini Files API + per-segment offsets +
  // DeepSeek consolidation). Set GEMINI_VISUAL_ANALYSIS_ENABLED=true and the
  // matching GEMINI_API_BASE_URL / GEMINI_API_KEY to enable. Off => skipped.
  const consolidator = createDeepSeekConsolidator({ model: deepseekModel });
  const analyzeRecordingVisuals = createGeminiVisualAnalyzerFromEnv({ consolidator });

  return {
    now: () => Date.now(),

    async findSession(id: string): Promise<SessionRecord | null> {
      try {
        const doc = (await db.getDocument(DB, "interview_sessions", id)) as any;
        return {
          $id: doc.$id,
          surveyId: doc.surveyId,
          state: doc.state,
          collectedAnswers: parseJson(doc.collectedAnswers, {}),
        };
      } catch (e: any) {
        if (e?.code === 404) return null;
        throw e;
      }
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

    async getRecordingBytes(recording: RecordingRecord) {
      const buffer = await storage.getFileDownload("recordings", recording.storageFileId);
      return {
        bytes: new Uint8Array(buffer),
        mimeType: recordingMimeType(recording.format),
      };
    },
    ...(analyzeRecordingVisuals ? { analyzeRecordingVisuals } : {}),

    async findSurveyContext(surveyId: string): Promise<SurveyContext | null> {
      try {
        const survey = (await db.getDocument(DB, "surveys", surveyId)) as any;
        const project = (await db.getDocument(DB, "projects", survey.projectId)) as any;
        const sectionsRes = await db.listDocuments(DB, "survey_sections", [
          Query.equal("surveyId", surveyId),
          Query.orderAsc("order"),
          Query.limit(200),
        ]);
        const questionsRes = await db.listDocuments(DB, "question_blocks", [
          Query.equal("surveyId", surveyId),
          Query.orderAsc("order"),
          Query.limit(500),
        ]);
        return {
          surveyId,
          ownerUserId: project.ownerUserId,
          title: survey.title,
          flowConfig: parseJson(survey.flowConfig, {}),
          sections: sectionsRes.documents.map((s: any) => ({
            $id: s.$id,
            surveyId: s.surveyId,
            title: s.title,
            description: s.description ?? "",
            order: s.order,
          })),
          questionBlocks: questionsRes.documents.map((q: any) => ({
            $id: q.$id,
            surveyId: q.surveyId,
            sectionId: q.sectionId,
            order: q.order,
            orderInSection: q.orderInSection,
            type: q.type,
            prompt: q.prompt,
            config: parseJson(q.config, {}),
          })),
        };
      } catch (e: any) {
        if (e?.code === 404) return null;
        throw e;
      }
    },

    async analyzeWithLLM(input: AnalysisReportInput): Promise<AnalysisReportOutput> {
      const userPrompt = buildSessionAnalyzeUserPrompt({
        surveyTitle: input.survey.title,
        questions: input.survey.questionBlocks.map((q) => ({
          questionId: q.$id,
          questionType: q.type,
          prompt: q.prompt,
        })),
        // Synthesize transcriptId from input.sessionId so the LLM-produced
        // segmentRefs can be mapped back. The real transcript id is fetched
        // from findTranscript and we pass it through input.transcript.
        segments: input.transcript.segments.map((s, idx) => ({
          transcriptId: input.sessionId,
          segmentIndex: idx,
          speaker: s.speaker,
          text: s.text,
        })),
        collectedAnswers: input.collectedAnswers,
      });

      const { experimental_output } = await generateText({
        model: deepseekModel,
        maxRetries: 2,
        experimental_output: Output.object({ schema: AnalysisReportOutputSchema }),
        system: SESSION_ANALYZE_SYSTEM,
        prompt: userPrompt,
      });

      // generateText output is already validated against the schema by the
      // SDK, but re-parse defensively for clarity.
      return AnalysisReportOutputSchema.parse(experimental_output);
    },

    async upsertSessionReport({ sessionId, surveyId, ownerUserId, body, generatedAt }) {
      // Find existing report for (scope=session, sessionId)
      const existing = await db.listDocuments(DB, "analysis_reports", [
        Query.equal("scope", "session"),
        Query.equal("sessionId", sessionId),
        Query.limit(1),
      ]);
      const payload = {
        sessionId,
        surveyId,
        scope: "session" as const,
        ownerUserId,
        themes: JSON.stringify(body.themes),
        // store the rest of the body's structured fields under `insights` jsonb
        // (perQuestionSummary + insights both kept here so the read layer can
        // expose them; the column name is historical, not literal).
        insights: JSON.stringify({
          insights: body.insights,
          perQuestionSummary: body.perQuestionSummary,
          visualAnalysis: body.visualAnalysis ?? null,
        }),
        citations: JSON.stringify(body.citations),
        generatedAt,
      };
      const permissions = [
        Permission.read(Role.user(ownerUserId)),
      ];

      if (existing.documents.length > 0) {
        const doc = existing.documents[0] as any;
        await db.updateDocument(DB, "analysis_reports", doc.$id, payload);
        return { reportId: doc.$id };
      } else {
        const created = await db.createDocument(
          DB,
          "analysis_reports",
          ID.unique(),
          payload,
          permissions,
        );
        return { reportId: (created as any).$id };
      }
    },
  };
}
