import { z } from "zod";

/**
 * 研究员针对某个 study 的"聚焦问题"的 LLM 论证型回答 schema。
 *
 * 与自动生成的 AnalysisReport 不同：Insight 是研究员主动发起的（输入一个问题），
 * 报告内容围绕这个问题做立场分歧 / 内在张力 / 分群证据 / 行动建议。
 *
 * 这份 schema 同时被 (a) DeepSeek 生成时的 response_format 使用、
 * (b) Insight entity 的 `report` 字段使用。
 */
export const insightReportSchema = z.object({
  headline: z.string().describe("一句话核心结论,作为这份分析的标题,精炼有力"),
  directAnswer: z.string().describe("用 2-3 句直接、明确地回答这个问题,给出立场"),
  confidence: z.enum(["high", "medium", "low"]).describe("基于现有数据对该结论的置信度"),
  confidenceReason: z.string().describe("一句话说明置信度判断依据,如样本量/一致性"),
  themes: z
    .array(
      z.object({
        title: z.string().describe("一个分析维度/角度的标题"),
        analysis: z.string().describe("围绕该维度对会话内容的深入分析,3-4 句"),
        quotes: z.array(z.string()).describe("1-3 条支撑该维度的受访者原话"),
      }),
    )
    .describe("3-4 个分析维度,逐层拆解这个问题"),
  divergences: z
    .array(
      z.object({
        group: z.string().describe("持该观点的人群/立场描述"),
        stance: z.string().describe("该群体的核心主张"),
      }),
    )
    .describe("2-3 组受访者之间的观点分歧或对立立场"),
  actions: z
    .array(
      z.object({
        priority: z.enum(["P0", "P1", "P2"]).describe("优先级"),
        action: z.string().describe("具体可执行的行动建议"),
        rationale: z.string().describe("为什么这么做,关联到上面的分析"),
      }),
    )
    .describe("3-4 条分优先级的行动建议"),
});

export type InsightReport = z.infer<typeof insightReportSchema>;

/**
 * Insight entity（持久化在 Appwrite 的 `Insight` collection）。
 *
 * 与 AnalysisReport 是不同的实体：
 * - Insight 由研究员主动发起（一个 question + AI 报告），生命周期由研究员控制。
 * - AnalysisReport 由 session 完成自动生成（scope=session）或聚合产出（scope=survey）。
 *
 * 详见 docs/adr/0003-analysis-report-architecture.md 的 D2 决策。
 */
export const InsightSchema = z.object({
  $id: z.string(),
  studyId: z.string(),
  studyTitle: z.string(),
  question: z.string(),
  // 卡片视图用的"快速字段"，与 report 里的 headline / directAnswer / confidence 冗余存储
  // 是为了卡片列表查询无需展开 report jsonb。
  headline: z.string(),
  summary: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  sampleSize: z.number().int().nonnegative(),
  // 完整论证报告（结论 + 主题分析 + 分歧 + 行动建议）
  report: insightReportSchema,
  ownerUserId: z.string(),
  createdAt: z.string().datetime(),
});

export type Insight = z.infer<typeof InsightSchema>;
