// Real deps: Appwrite Server SDK + DeepSeek via @ai-sdk/deepseek.
import { Client, Databases, Functions, ID, Permission, Query, Role } from "node-appwrite";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, Output } from "ai";
import { withLLMCall, createLogger } from "@merism/observability";
import {
  AnalysisReportOutputSchema,
  visualAnalysisJobId,
  type AnalysisReportInput,
  type AnalysisReportOutput,
  type GenerationMeta,
  type SessionQualityFlag,
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
import {
  QUALITY_FLAGS_SYSTEM,
  QualityFlagsLLMOutputSchema,
  buildQualityFlagsPromptInput,
  buildQualityFlagsUserPrompt,
} from "./prompts/quality-flags.js";
import { SESSION_QUALITY_FLAG_LLM_TEMPERATURE } from "./constants.js";

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
  const storageFunctions = new Functions(client);
  const visualFunctionId = process.env.ANALYZE_SESSION_VISUAL_FUNCTION_ID;
  const deepseek = createDeepSeek({
    apiKey: env.DEEPSEEK_API_KEY,
    ...(env.DEEPSEEK_BASE_URL ? { baseURL: env.DEEPSEEK_BASE_URL } : {}),
  });
  const modelName = env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const deepseekModel = deepseek(modelName);

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

    // ADR 0005 D1: durable trigger + async enqueue (analyzeSessionVisual).
    // Both gated on the function id; best-effort by contract (handler swallows).
    ...(visualFunctionId
      ? {
          async ensureVisualJobQueued({ sessionId, surveyId, ownerUserId }): Promise<void> {
            const nowIso = new Date().toISOString();
            try {
              await db.createDocument(
                DB,
                "visual_analysis_jobs",
                visualAnalysisJobId(sessionId),
                {
                  sessionId,
                  surveyId,
                  ownerUserId,
                  status: "queued",
                  geminiFileName: null,
                  geminiUploadedAt: null,
                  attemptCount: 0,
                  createdAt: nowIso,
                  updatedAt: nowIso,
                },
                [Permission.read(Role.user(ownerUserId))],
              );
            } catch (e: any) {
              // 409 => a prior completion already created the row (dedup). Fine.
              if (e?.code !== 409) throw e;
            }
          },
          async enqueueVisualAnalysis(sessionId: string): Promise<void> {
            await storageFunctions.createExecution(
              visualFunctionId,
              JSON.stringify({ sessionId }),
              true, // async: don't block the text path on the video pass
            );
          },
        }
      : {}),

    async findSurveyContext(surveyId: string): Promise<SurveyContext | null> {
      try {
        const survey = (await db.getDocument(DB, "surveys", surveyId)) as any;
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
        // Owner derivation per ADR-0006: prefer `survey.authorId` (post-recast
        // canonical author), fall back to `survey.ownerUserId` (M2 legacy
        // column), then to `project.ownerUserId` only when the survey row
        // carries neither. Reading the project last avoids a redundant round
        // trip and decouples report ownership from the near-vestigial projects
        // collection. Old seed data where project.ownerUserId diverges from
        // survey.ownerUserId no longer writes reports under the wrong owner.
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

    async analyzeWithLLM(
      input: AnalysisReportInput,
      opts?: {
        hallucinationHint?: { badRefs: Array<{ transcriptId: string; segmentIndex: number }> };
      },
    ): Promise<AnalysisReportOutput> {
      const baseUserPrompt = buildSessionAnalyzeUserPrompt({
        surveyTitle: input.survey.title,
        questions: input.survey.questionBlocks.map((q) => ({
          questionId: q.$id,
          questionType: q.type,
          prompt: q.prompt,
        })),
        segments: input.transcript.segments.map((s, idx) => ({
          transcriptId: input.sessionId,
          segmentIndex: idx,
          speaker: s.speaker,
          text: s.text,
        })),
        collectedAnswers: input.collectedAnswers,
      });

      // analysis-report-v2 R3 / design §6.3: 第二次调用时把 hallucination hint
      // 前置到 user prompt 顶部, system prompt 不动以保 prompt cache 命中。
      // 语义是"替换" not "删除", 找不到 valid refs 的 theme 整体丢弃。
      const userPrompt = opts?.hallucinationHint
        ? [
            "你上一次输出的下列 segmentRef 不存在于 transcript 中, 这是不可接受的:",
            opts.hallucinationHint.badRefs
              .map((r) => `  - { transcriptId: "${r.transcriptId}", segmentIndex: ${r.segmentIndex} }`)
              .join("\n"),
            "",
            "请重新输出。规则:",
            "- **替换**, 不要删除: 把 bad refs 替换为 transcript 中真实存在的 (transcriptId, segmentIndex) 二元组。",
            "- 每个 theme 必须保留 ≥ 1 条 valid evidence (P-ANL-01 要求)。",
            "- 若某 theme 找不到任何 valid refs 可用, 该 theme **整体丢弃**, 而不是返回 0 个 evidence。",
            "- 其余规则(citations.quote 必须逐字, themeIds 必须存在, 等等)保持不变。",
            "",
            baseUserPrompt,
          ].join("\n")
        : baseUserPrompt;

      const log = createLogger("function.analyzeSession.text-pass");
      const { experimental_output } = await withLLMCall(
        {
          scope: "function.analyzeSession.text-pass",
          traceId: log.traceId,
          defaultModel: "deepseek-chat",
        },
        () =>
          generateText({
            model: deepseekModel,
            maxRetries: 2,
            experimental_output: Output.object({ schema: AnalysisReportOutputSchema }),
            system: SESSION_ANALYZE_SYSTEM,
            prompt: userPrompt,
          }),
      );

      return AnalysisReportOutputSchema.parse(experimental_output);
    },

    async deriveQualityFlagsWithLLM({ transcript, surveyContext }) {
      const promptInput = buildQualityFlagsPromptInput({ transcript, surveyContext });
      const userPrompt = buildQualityFlagsUserPrompt(promptInput);
      const log = createLogger("function.analyzeSession.quality-flags");
      const { experimental_output } = await withLLMCall(
        {
          scope: "function.analyzeSession.quality-flags",
          traceId: log.traceId,
          defaultModel: "deepseek-chat",
        },
        () =>
          generateText({
            model: deepseekModel,
            temperature: SESSION_QUALITY_FLAG_LLM_TEMPERATURE,
            maxRetries: 1,
            experimental_output: Output.object({ schema: QualityFlagsLLMOutputSchema }),
            system: QUALITY_FLAGS_SYSTEM,
            prompt: userPrompt,
          }),
      );
      const parsed = QualityFlagsLLMOutputSchema.parse(experimental_output);
      // Semantic flags are a subset of SessionQualityFlag (compile-time asserted in
      // prompts/quality-flags.ts), so widening cast is safe.
      return { flags: parsed.flags as SessionQualityFlag[] };
    },

    async updateInterviewSessionFlags(sessionId, flags) {
      // analysis-report-v2 D6: best-effort. The handler logs warn on throw.
      await db.updateDocument(DB, "interview_sessions", sessionId, {
        qualityFlags: flags,
      });
    },

    async updateSessionErrorContext(sessionId, ctx) {
      await db.updateDocument(DB, "interview_sessions", sessionId, {
        errorContext: JSON.stringify(ctx),
      });
    },

    async upsertSessionReport({ sessionId, surveyId, ownerUserId, body, generatedAt, generationMeta }) {
      // Find existing report for (scope=session, sessionId)
      const existing = await db.listDocuments(DB, "analysis_reports", [
        Query.equal("scope", "session"),
        Query.equal("sessionId", sessionId),
        Query.limit(1),
      ]);
      const payload: Record<string, unknown> = {
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
      if (generationMeta) {
        payload.generationMeta = JSON.stringify(generationMeta);
      }
      // ADR-0006 (B): a report is readable by its survey's workspace team
      // (resolve workspaceId from the survey) plus the owner. Additive — the
      // study-level API-key read still works; this enables native session-client
      // reads by workspace members. Update path passes perms too so re-runs
      // converge old owner-only reports to team-readable.
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
