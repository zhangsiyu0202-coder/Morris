// Real deps wiring Appwrite Server SDK. All effects go through the pure
// handler.ts; this file only translates typed operations into SDK calls.
//
// Collection ids match packages/appwrite-schema and the deleted
// apps/agent/agent/persistence/serializers.py (kept identical intentionally).
import { Client, Databases, Functions } from "node-appwrite";
import type { FinalizeDeps, SessionRecord } from "./handler.js";

const DB = "merism";
const INTERVIEW_SESSIONS = "interview_sessions";
const TRANSCRIPTS = "transcripts";
const USAGE_EVENTS = "usage_events";
const DEFAULT_ANALYZE_SESSION_FN = "analyzeSession";

interface Env {
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_ID: string;
  APPWRITE_API_KEY: string;
  ANALYZE_SESSION_FUNCTION_ID: string;
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
    ANALYZE_SESSION_FUNCTION_ID:
      process.env.ANALYZE_SESSION_FUNCTION_ID ?? DEFAULT_ANALYZE_SESSION_FN,
  };
}

export function createRealDeps(): FinalizeDeps {
  const env = requireEnv();
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const db = new Databases(client);
  const fns = new Functions(client);

  return {
    now: () => Date.now(),

    async getSession(sessionId: string): Promise<SessionRecord | null> {
      try {
        const doc = (await db.getDocument(DB, INTERVIEW_SESSIONS, sessionId)) as unknown as {
          $id: string;
          surveyId: string;
          ownerUserId?: string;
          workspaceId?: string | null;
          state: SessionRecord["state"];
        };
        return {
          $id: doc.$id,
          surveyId: doc.surveyId,
          ownerUserId: doc.ownerUserId ?? null,
          workspaceId: doc.workspaceId ?? null,
          state: doc.state,
        };
      } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code === 404) return null;
        throw error;
      }
    },

    async updateSession(sessionId, fields): Promise<void> {
      await db.updateDocument(DB, INTERVIEW_SESSIONS, sessionId, fields);
    },

    async upsertTranscript(sessionId, body, permissions): Promise<void> {
      const document = {
        sessionId,
        segments: JSON.stringify(body.segments),
        language: body.language,
        finalizedAt: body.finalizedAt,
      };
      try {
        await db.createDocument(DB, TRANSCRIPTS, sessionId, document, permissions ?? []);
      } catch (error) {
        const code = (error as { code?: number })?.code;
        // 409 = already exists; upsert via update.
        if (code === 409) {
          await db.updateDocument(DB, TRANSCRIPTS, sessionId, document);
          return;
        }
        throw error;
      }
    },

    async emitUsageEvent(args): Promise<void> {
      // Deterministic id keyed on sessionId so a retry can't emit two rows.
      const usageEventId = `usage_${args.sessionId}`;
      const document = {
        workspaceId: args.workspaceId ?? "",
        studyId: args.surveyId,
        sessionId: args.sessionId,
        unit: "completed_interview",
        occurredAt: args.occurredAt,
      };
      try {
        await db.createDocument(DB, USAGE_EVENTS, usageEventId, document);
      } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code === 409) return; // idempotent
        throw error;
      }
    },

    async triggerAnalysis(args): Promise<void> {
      await fns.createExecution(
        env.ANALYZE_SESSION_FUNCTION_ID,
        JSON.stringify({ sessionId: args.sessionId, surveyId: args.surveyId }),
        true, // async
      );
    },
  };
}
