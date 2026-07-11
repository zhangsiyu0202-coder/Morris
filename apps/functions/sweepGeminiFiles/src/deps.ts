// Real deps: Appwrite Server SDK + Gemini Files API delete.
import { Client, Databases, Functions, Query } from "node-appwrite";
import { visualAnalysisJobId } from "@merism/contracts";
import type { RetryJob, SweepDeps, SweepJob } from "./handler.js";

const DB = "merism";
const COLLECTION = "visual_analysis_jobs";
const LIST_LIMIT = 200;
const STUCK_AFTER_MS = (() => {
  const v = Number.parseInt(process.env.GEMINI_VISUAL_STUCK_AFTER_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 15 * 60 * 1000;
})();

function req(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function parseUploadedMs(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

// Lazy single client so the delete path doesn't require @google/genai unless used.
async function deleteFile(apiKey: string, baseUrl: string | undefined, name: string): Promise<void> {
  const mod = await import("@google/genai");
  const GoogleGenAI = (mod as { GoogleGenAI: new (init: unknown) => any }).GoogleGenAI;
  const client = new GoogleGenAI({
    apiKey,
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  });
  try {
    await client.files.delete({ name });
  } catch (e: any) {
    // Already gone (a previous clear failed) — treat as success so we stop retrying.
    const code = e?.status ?? e?.code;
    if (code === 404) return;
    throw e;
  }
}

export function createRealDeps(): SweepDeps {
  const client = new Client()
    .setEndpoint(req("APPWRITE_ENDPOINT"))
    .setProject(req("APPWRITE_PROJECT_ID"))
    .setKey(req("APPWRITE_API_KEY"));
  const db = new Databases(client);
  const functions = new Functions(client);

  const apiKey = req("GEMINI_API_KEY");
  const baseUrl = process.env.GEMINI_API_BASE_URL;
  const minAgeMs = Number.parseInt(process.env.GEMINI_SWEEP_MIN_AGE_MS ?? "", 10);
  const visualFunctionId = process.env.ANALYZE_SESSION_VISUAL_FUNCTION_ID;

  return {
    now: () => Date.now(),
    maxFiles: LIST_LIMIT,
    deleteConcurrency: 5,
    stuckAfterMs: STUCK_AFTER_MS,
    ...(Number.isFinite(minAgeMs) && minAgeMs > 0 ? { minAgeMs } : {}),

    async listTrackedFiles(): Promise<SweepJob[]> {
      const res = await db.listDocuments(DB, COLLECTION, [
        Query.isNotNull("geminiFileName"),
        Query.limit(LIST_LIMIT),
      ]);
      return res.documents.map((doc: any) => ({
        sessionId: doc.sessionId,
        status: doc.status,
        geminiFileName: doc.geminiFileName,
        geminiUploadedAtMs: parseUploadedMs(doc.geminiUploadedAt),
      }));
    },

    async deleteGeminiFile(geminiFileName: string): Promise<void> {
      await deleteFile(apiKey, baseUrl, geminiFileName);
    },

    async clearJobFile(sessionId: string): Promise<void> {
      await db.updateDocument(DB, COLLECTION, visualAnalysisJobId(sessionId), {
        geminiFileName: null,
        updatedAt: new Date().toISOString(),
      });
    },

    // Reaper (ADR 0005 D1) — only wired when the analyzeSessionVisual function
    // id is known (otherwise re-enqueue is impossible and the pass is skipped).
    ...(visualFunctionId
      ? {
          async listRetryCandidates(): Promise<RetryJob[]> {
            const cutoffIso = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
            const res = await db.listDocuments(DB, COLLECTION, [
              Query.notEqual("status", "succeeded"),
              Query.lessThan("updatedAt", cutoffIso),
              Query.limit(LIST_LIMIT),
            ]);
            return res.documents.map((doc: any) => ({
              sessionId: doc.sessionId,
              status: doc.status,
              attemptCount: doc.attemptCount ?? 0,
              updatedAtMs: Date.parse(doc.updatedAt ?? doc.$updatedAt ?? "") || 0,
            }));
          },
          async reenqueue(sessionId: string): Promise<void> {
            await functions.createExecution(visualFunctionId, JSON.stringify({ sessionId }), true);
          },
          async failJob(sessionId: string): Promise<void> {
            await db.updateDocument(DB, COLLECTION, visualAnalysisJobId(sessionId), {
              status: "failed",
              errorContext: JSON.stringify({ reason: "max_attempts_exceeded" }),
              updatedAt: new Date().toISOString(),
            });
          },
        }
      : {}),
  };
}
