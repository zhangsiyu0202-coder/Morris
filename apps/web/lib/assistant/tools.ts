import { tool } from "ai";
import { z } from "zod";
import {
  getLatestAnalysisReport,
  listStudies,
  parseSurveyReportBody,
  searchTranscriptSegments,
} from "@/lib/queries";

/**
 * Morris assistant tool layer. Sourced from real Appwrite reads via the
 * lib/queries layer; ownership is enforced via the `ownerUserId` injected
 * by the route handler at request time.
 *
 * Per-request factory (`buildAssistantTools(ctx)`) so that each request gets
 * tools bound to its researcher identity. A null `ownerUserId` (signed-out)
 * makes every tool short-circuit with a friendly "请先登录" error, rather
 * than reading anything.
 *
 * `createStudyDraft` is intentionally kept as a mock until the
 * `survey-editor` sub-spec lands a creation flow. See ADR-0003 §Out of scope.
 */

export type ToolError = { error: true; message: string };

export interface AssistantToolContext {
  /** Resolved by the route handler from the Appwrite cookie session. */
  ownerUserId: string | null;
}

function toToolError(label: string, err: unknown): ToolError {
  const detail = err instanceof Error ? err.message : String(err);
  return { error: true, message: `${label}失败:${detail}` };
}

const NOT_SIGNED_IN: ToolError = {
  error: true,
  message: "请先登录后再使用研究助手的检索/分析能力。",
};

// Mock prompt bank kept here for createStudyDraft. Remove when survey-editor
// lands a real draft creation flow.
const STUDY_QUESTION_BANK = [
  "当你需要解决这个问题时,通常会怎么做?",
  "请回想最近一次相关的经历,具体发生了什么?",
  "在这个过程中,最让你困扰的是什么?",
  "你尝试过哪些替代方案?效果如何?",
  "如果有一个理想的解决方案,它应该是什么样的?",
  "你愿意为此付出多少时间或成本?",
  "还有什么我们没问到、但你觉得重要的吗?",
  "你是如何评估一个方案是否值得继续使用的?",
  "在做决定时,谁或什么会影响你?",
  "回到最开始,你希望当时有人告诉你什么?",
];

export function buildAssistantTools(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;

  return {
    listStudies: tool({
      description:
        "列出当前账户下的所有调研及其状态与样本量。当用户问有哪些调研、或需要先了解上下文再决定调用哪个工具时调用。",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const surveys = await listStudies(ownerUserId);
          return {
            studies: surveys.map((s) => ({
              id: s.$id,
              title: s.title,
              status: s.status,
              version: s.version,
              updatedAt: s.updatedAt,
            })),
          };
        } catch (err) {
          return toToolError("读取调研列表", err);
        }
      },
    }),

    searchInterviewData: tool({
      description:
        "在已有访谈记录中检索与关键词相关的受访者回答片段。当用户想了解受访者具体说了什么、查找原话或某类反馈时调用。需要 studyId 限定到具体调研。",
      inputSchema: z.object({
        query: z.string().describe("检索关键词,可为空字符串以返回全部"),
        studyId: z.string().describe("要检索的调研 id (必填,不限定调研时无法跨调研检索)"),
      }),
      execute: async ({ query, studyId }) => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const hits = await searchTranscriptSegments(ownerUserId, {
            query: query ?? "",
            surveyId: studyId,
            limit: 20,
          });
          return {
            count: hits.length,
            snippets: hits.map((h) => ({
              sessionId: h.sessionId,
              transcriptId: h.transcriptId,
              segmentIndex: h.segmentIndex,
              speaker: h.speaker,
              text: h.text,
              startMs: h.startMs,
              endMs: h.endMs,
            })),
          };
        } catch (err) {
          return toToolError("检索访谈数据", err);
        }
      },
    }),

    analyzeData: tool({
      description:
        "返回指定调研的最新 survey 级聚合分析报告(由 analyzeSurvey Function 生成并落 Appwrite)。当用户想要整体洞察、趋势或主题分布时调用。",
      inputSchema: z.object({
        studyId: z.string().describe("要分析的调研 id (必填)"),
      }),
      execute: async ({ studyId }) => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const stored = await getLatestAnalysisReport(ownerUserId, {
            surveyId: studyId,
            scope: "survey",
          });
          if (!stored) {
            return {
              error: true,
              message:
                "尚无 survey 级聚合报告。可在 /reports/" + studyId + " 中生成,或等待新一场访谈完成后系统自动产出。",
            } as ToolError;
          }
          const body = parseSurveyReportBody(stored);
          if (!body) {
            return toToolError("解析报告", new Error("schema_mismatch"));
          }
          // Return a compact, render-stable subset; the UI side already
          // renders this from /reports/[surveyId], so the tool focuses on
          // the headline numbers + top themes/insights for the chat.
          return {
            studyTitle: body.surveyTitle,
            completedRespondents: body.completedRespondents,
            topThemes: body.themes.slice(0, 5).map((t) => ({
              label: t.label,
              mentions: t.mentions,
              pct: t.pct,
              sentiment: t.sentiment,
            })),
            topInsights: body.insights.slice(0, 4).map((i) => ({
              title: i.title,
              text: i.text,
              confidence: i.confidence,
            })),
          };
        } catch (err) {
          return toToolError("分析调研数据", err);
        }
      },
    }),

    createStudyDraft: tool({
      description:
        "[临时] 根据研究目标创建一份调研草稿,产出标题、研究目标和建议问题列表。当前为 mock 输出;真实创建流程待 survey-editor 子 spec 落地后再接通。",
      inputSchema: z.object({
        goal: z.string().min(1).describe("研究目标的自然语言描述"),
        audience: z.string().nullable().describe("目标受访人群,可为空"),
        questionCount: z.number().int().min(3).max(10).describe("建议的问题数量(3-10)"),
      }),
      execute: async ({ goal, audience, questionCount }) => {
        try {
          const count = Math.min(Math.max(Math.round(questionCount), 3), 10);
          const questions = STUDY_QUESTION_BANK.slice(0, count).map((q, i) => ({
            order: i + 1,
            prompt: q,
          }));
          return {
            title: `${goal.slice(0, 20)} — 用户调研`,
            goal,
            audience: audience?.trim() ? audience : "未指定",
            questions,
            // Surface the mock disclaimer so the model can pass it on.
            note:
              "当前为草稿提案(mock),未在 Appwrite 中创建真实 Survey 行。survey-editor 子 spec 实施后将接通真实创建流程。",
          };
        } catch (err) {
          return toToolError("创建调研草稿", err);
        }
      },
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
