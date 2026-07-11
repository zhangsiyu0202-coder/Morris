// Real deps: Appwrite Server SDK + DeepSeek via @ai-sdk/deepseek.
import { Client, Databases, ID, Permission, Query, Role } from "node-appwrite";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, Output } from "ai";
import { withLLMCall, createLogger } from "@merism/observability";
import type {
  AnalyzeSurveyDeps,
  AssignThemesInput,
  CombineThemesInput,
  ComposeInsightsInput,
  ExtractThemesInput,
  SessionDigest,
  SessionLevelReport,
  SurveyContextLite,
} from "./handler.js";
import {
  THEME_EXTRACTION_SYSTEM,
  buildThemeExtractionUserPrompt,
} from "./prompts/theme-extraction.js";
import {
  THEME_ASSIGNMENT_SYSTEM,
  buildThemeAssignmentUserPrompt,
} from "./prompts/theme-assignment.js";
import {
  THEME_COMBINATION_SYSTEM,
  buildThemeCombinationUserPrompt,
} from "./prompts/theme-combination.js";
import {
  COMPOSE_INSIGHTS_SYSTEM,
  buildComposeInsightsUserPrompt,
} from "./prompts/compose-insights.js";
import {
  ComposeInsightsOutputSchema,
  ExtractedThemesListSchema,
  ThemeAssignmentListSchema,
} from "./rollup.js";
import { ROLLUP_LLM_TEMPERATURE } from "./constants.js";

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
        const flow = parseJson<{ topics?: string[] }>(survey.flowConfig, {});
        const questionsRes = await db.listDocuments(DB, "question_blocks", [
          Query.equal("surveyId", surveyId),
          Query.orderAsc("order"),
          Query.limit(500),
        ]);
        // Owner derivation per ADR-0006: prefer `survey.authorId` (the post-recast
        // canonical author), fall back to `survey.ownerUserId` (legacy column kept
        // through M2 migration), then to `project.ownerUserId` only when the
        // survey row carries neither. Reading the project last avoids a redundant
        // round trip on the hot path and decouples report ownership from the
        // near-vestigial projects collection (P-ANL-Owner). Old seed data where
        // project.ownerUserId diverges from survey.ownerUserId no longer writes
        // reports under the wrong owner.
        let ownerUserId: string | undefined = survey.authorId ?? survey.ownerUserId;
        if (!ownerUserId) {
          const project = (await db.getDocument(DB, "projects", survey.projectId)) as any;
          ownerUserId = project.ownerUserId;
        }
        if (!ownerUserId) return null;
        return {
          surveyId,
          ownerUserId,
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

    async extractThemesWithLLM(input: ExtractThemesInput) {
      const log = createLogger("function.analyzeSurvey.extract-themes");
      const { experimental_output } = await withLLMCall(
        {
          scope: "function.analyzeSurvey.extract-themes",
          traceId: log.traceId,
          defaultModel: modelName,
        },
        () =>
          generateText({
            model: deepseek(modelName),
            temperature: ROLLUP_LLM_TEMPERATURE,
            maxRetries: 2,
            experimental_output: Output.object({ schema: ExtractedThemesListSchema }),
            system: THEME_EXTRACTION_SYSTEM,
            prompt: buildThemeExtractionUserPrompt(input),
          }),
      );
      return ExtractedThemesListSchema.parse(experimental_output);
    },

    async assignThemesWithLLM(input: AssignThemesInput) {
      const log = createLogger("function.analyzeSurvey.assign-themes");
      const { experimental_output } = await withLLMCall(
        {
          scope: "function.analyzeSurvey.assign-themes",
          traceId: log.traceId,
          defaultModel: modelName,
        },
        () =>
          generateText({
            model: deepseek(modelName),
            temperature: ROLLUP_LLM_TEMPERATURE,
            maxRetries: 2,
            experimental_output: Output.object({ schema: ThemeAssignmentListSchema }),
            system: THEME_ASSIGNMENT_SYSTEM,
            prompt: buildThemeAssignmentUserPrompt(input),
          }),
      );
      return ThemeAssignmentListSchema.parse(experimental_output);
    },

    async combineThemesWithLLM(input: CombineThemesInput) {
      // Wave F (D15): combination LLM 把多份 chunked extraction 结果合一份。
      // 输出 schema 复用 ExtractedThemesListSchema (合并后形态与单次抽取等价)。
      const log = createLogger("function.analyzeSurvey.combine-themes");
      const { experimental_output } = await withLLMCall(
        {
          scope: "function.analyzeSurvey.combine-themes",
          traceId: log.traceId,
          defaultModel: modelName,
        },
        () =>
          generateText({
            model: deepseek(modelName),
            temperature: ROLLUP_LLM_TEMPERATURE,
            maxRetries: 2,
            experimental_output: Output.object({ schema: ExtractedThemesListSchema }),
            system: THEME_COMBINATION_SYSTEM,
            prompt: buildThemeCombinationUserPrompt(input),
          }),
      );
      return ExtractedThemesListSchema.parse(experimental_output);
    },

    async composeInsightsWithLLM(input: ComposeInsightsInput) {
      const baseUserPrompt = buildComposeInsightsUserPrompt({
        surveyTitle: input.surveyTitle,
        totalSessions: input.totalSessions,
        themes: input.themes,
        themeContexts: input.themeContexts,
        questionStats: input.questionStats,
        sessionReports: input.sessionReports,
      });
      const userPrompt = input.hallucinationHint
        ? [
            "你上一次输出的下列 segmentRef 不存在于 sessionReports 的 themes/citations 集合中, 这是不可接受的:",
            input.hallucinationHint.badRefs
              .map((r) => `  - { transcriptId: "${r.transcriptId}", segmentIndex: ${r.segmentIndex} }`)
              .join("\n"),
            "",
            "请重新输出。规则:",
            "- 只引用 sessionReports 已有的 segmentRef (不能凭空造)。",
            "- 若某 citation 找不到 valid segmentRef, 整条 citation 整体丢弃 (而不是返回 invalid segmentRef)。",
            "- 其余规则保持不变。",
            "",
            baseUserPrompt,
          ].join("\n")
        : baseUserPrompt;
      const log = createLogger("function.analyzeSurvey.compose-insights");
      const { experimental_output } = await withLLMCall(
        {
          scope: "function.analyzeSurvey.compose-insights",
          traceId: log.traceId,
          defaultModel: modelName,
        },
        () =>
          generateText({
            model: deepseek(modelName),
            temperature: ROLLUP_LLM_TEMPERATURE,
            maxRetries: 2,
            experimental_output: Output.object({ schema: ComposeInsightsOutputSchema }),
            system: COMPOSE_INSIGHTS_SYSTEM,
            prompt: userPrompt,
          }),
      );
      return ComposeInsightsOutputSchema.parse(experimental_output);
    },

    async upsertSurveyReport({ surveyId, ownerUserId, body, generatedAt, generationMeta }) {
      const existing = await db.listDocuments(DB, "analysis_reports", [
        Query.equal("scope", "survey"),
        Query.equal("surveyId", surveyId),
        Query.limit(1),
      ]);
      const payload: Record<string, unknown> = {
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
      if (generationMeta) {
        payload.generationMeta = JSON.stringify(generationMeta);
      }
      // ADR-0006 (B): survey-level report readable by the survey's workspace
      // team + owner (additive; enables native session-client team reads).
      let wsId: string | undefined;
      try {
        wsId = ((await db.getDocument(DB, "surveys", surveyId)) as { workspaceId?: string }).workspaceId ?? undefined;
      } catch {
        // survey unreadable/deleted → owner-only perms
      }
      const permissions = [
        Permission.read(Role.user(ownerUserId)),
        ...(wsId ? [Permission.read(Role.team(wsId))] : []),
      ];

      if (existing.documents.length > 0) {
        const doc = existing.documents[0] as any;
        await db.updateDocument(DB, "analysis_reports", doc.$id, payload, permissions);
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
