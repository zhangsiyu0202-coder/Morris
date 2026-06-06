// Real deps: Appwrite Server SDK + DeepSeek via @ai-sdk/deepseek.
import { Client, Databases, ID, Permission, Query, Role } from "node-appwrite";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, Output } from "ai";
import { z } from "zod";
import type {
  AnalyzeSurveyDeps,
  LlmRollupInput,
  LlmRollupOutput,
  SessionDigest,
  SessionLevelReport,
  SurveyContextLite,
} from "./handler.js";
import {
  SURVEY_ROLLUP_SYSTEM,
  buildSurveyRollupUserPrompt,
} from "./prompts/survey-rollup.js";

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

// LLM-output schema for the rollup. Subset of SurveyAnalysisReportOutputSchema
// with only the LLM-authored halves.
const llmRollupSchema = z.object({
  themes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      mentions: z.number().int().nonnegative(),
      pct: z.number().min(0).max(100),
      sentiment: z.enum(["positive", "neutral", "negative"]),
    }),
  ),
  insights: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      text: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  citations: z.array(
    z.object({
      segmentRef: z.object({
        transcriptId: z.string(),
        segmentIndex: z.number().int().nonnegative(),
      }),
      quote: z.string(),
      themeIds: z.array(z.string()),
    }),
  ),
  sentimentBreakdown: z.array(
    z.object({
      sentiment: z.enum(["positive", "neutral", "negative"]),
      count: z.number().int().nonnegative(),
    }),
  ),
  topics: z.array(z.string()).default([]),
  questionSummaries: z.record(z.string(), z.string()).default({}),
});

export function createRealDeps(): AnalyzeSurveyDeps {
  const env = requireEnv();
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const db = new Databases(client);
  const deepseek = createDeepSeek({
    apiKey: env.DEEPSEEK_API_KEY,
    ...(env.DEEPSEEK_BASE_URL ? { baseURL: env.DEEPSEEK_BASE_URL } : {}),
  });
  const modelName = env.DEEPSEEK_MODEL ?? "deepseek-chat";

  return {
    now: () => Date.now(),

    async findSurveyContext(surveyId: string): Promise<SurveyContextLite | null> {
      try {
        const survey = (await db.getDocument(DB, "surveys", surveyId)) as any;
        const project = (await db.getDocument(DB, "projects", survey.projectId)) as any;
        const flow = parseJson<{ topics?: string[] }>(survey.flowConfig, {});
        const questionsRes = await db.listDocuments(DB, "question_blocks", [
          Query.equal("surveyId", surveyId),
          Query.orderAsc("order"),
          Query.limit(500),
        ]);
        return {
          surveyId,
          ownerUserId: project.ownerUserId,
          title: survey.title,
          questionBlocks: questionsRes.documents.map((q: any) => ({
            questionId: q.$id,
            type: q.type,
            prompt: q.prompt,
            config: parseJson(q.config, {}),
          })),
          topics: flow.topics ?? [],
        };
      } catch (e: any) {
        if (e?.code === 404) return null;
        throw e;
      }
    },

    async findCompletedSessions(surveyId: string): Promise<SessionDigest[]> {
      const sessionsRes = await db.listDocuments(DB, "interview_sessions", [
        Query.equal("surveyId", surveyId),
        Query.equal("state", "completed"),
        Query.limit(500),
      ]);
      const sessions: SessionDigest[] = [];
      for (const doc of sessionsRes.documents as any[]) {
        const collected = parseJson<Record<string, any>>(doc.collectedAnswers, {});
        const answers = Object.entries(collected).map(([questionId, payload]) => ({
          sessionId: doc.$id,
          questionId,
          questionType: payload?.questionType ?? "open_ended",
          selectedOptions: Array.isArray(payload?.selectedOptions)
            ? payload.selectedOptions
            : payload?.text
              ? [payload.text]
              : undefined,
          score: typeof payload?.score === "number" ? payload.score : undefined,
        }));
        // Find a transcript id to thread through to LLM citations.
        const tRes = await db.listDocuments(DB, "transcripts", [
          Query.equal("sessionId", doc.$id),
          Query.orderDesc("finalizedAt"),
          Query.limit(1),
        ]);
        const transcriptId = (tRes.documents[0] as any)?.$id ?? doc.$id;
        sessions.push({
          sessionId: doc.$id,
          transcriptId,
          state: doc.state,
          answers,
        });
      }
      return sessions;
    },

    async findSessionReports(sessionIds: string[]): Promise<SessionLevelReport[]> {
      if (sessionIds.length === 0) return [];
      const reportsRes = await db.listDocuments(DB, "analysis_reports", [
        Query.equal("scope", "session"),
        Query.equal("sessionId", sessionIds),
        Query.limit(500),
      ]);
      return (reportsRes.documents as any[]).map((doc) => {
        const insightsRaw = parseJson<{ insights?: unknown[]; perQuestionSummary?: unknown[] }>(
          doc.insights,
          {},
        );
        return {
          reportId: doc.$id,
          sessionId: doc.sessionId,
          themes: parseJson(doc.themes, []),
          insights: insightsRaw.insights ?? [],
          citations: parseJson(doc.citations, []),
          perQuestionSummary: insightsRaw.perQuestionSummary ?? [],
        };
      });
    },

    async rollupWithLLM(input: LlmRollupInput): Promise<LlmRollupOutput> {
      const { experimental_output } = await generateText({
        model: deepseek(modelName),
        maxRetries: 2,
        experimental_output: Output.object({ schema: llmRollupSchema }),
        system: SURVEY_ROLLUP_SYSTEM,
        prompt: buildSurveyRollupUserPrompt({
          surveyTitle: input.surveyTitle,
          totalSessions: input.totalSessions,
          sessionReports: input.sessionReports.map((r) => ({
            sessionId: r.sessionId,
            transcriptId: r.sessionId, // session-level reports synthesize transcriptId from sessionId
            themes: r.themes,
            insights: r.insights,
            citations: r.citations,
            perQuestionSummary: r.perQuestionSummary,
          })),
        }),
      });
      return llmRollupSchema.parse(experimental_output);
    },

    async upsertSurveyReport({ surveyId, ownerUserId, body, generatedAt }) {
      const existing = await db.listDocuments(DB, "analysis_reports", [
        Query.equal("scope", "survey"),
        Query.equal("surveyId", surveyId),
        Query.limit(1),
      ]);
      const payload = {
        surveyId,
        scope: "survey" as const,
        ownerUserId,
        themes: JSON.stringify(body.themes),
        // The full survey-level body lives in `insights` (column reused as
        // jsonb blob) so the read layer can hydrate it via
        // SurveyAnalysisReportOutputSchema.
        insights: JSON.stringify(body),
        citations: JSON.stringify(body.citations),
        generatedAt,
      };
      const permissions = [Permission.read(Role.user(ownerUserId))];

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
