import { z } from "zod";

/**
 * 研究员针对某个 study 的"聚焦问题"的 LLM 论证型回答 schema (legacy fixed shape)。
 *
 * 背景: 在 Wave A 字面 rename 之前,Notebook (原 Insight) 的报告内容由这个固定 schema
 * 承载。Wave B 起新写入用 Markdown→ProseMirror content (字段 `Notebook.content`),
 * 这个 schema 仅作为旧数据 fallback 保留, Wave F 单独 cleanup commit 删除。
 *
 * 仍被使用的位置:
 * - DeepSeek `experimental_output: Output.object({ schema: notebookReportSchema })`
 *   作为 Wave D 之前的旧 createInsight/createNotebook server action 的 response_format
 *   (Wave D Morris createNotebook 工具改为 Markdown content 路径)。
 * - Notebook 文档的 `report` 可空字段 (旧数据 fallback)。
 */
export const notebookReportSchema = z.object({
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

export type NotebookReport = z.infer<typeof notebookReportSchema>;

/**
 * Notebook.visibility — `internal` (默认, 只 owner 可见) | `shared` (可生成
 * 分享 token, 第三方凭 token 只读访问)。见 R6 + design §7。
 */
export const NotebookVisibilitySchema = z.enum(["internal", "shared"]);
export type NotebookVisibility = z.infer<typeof NotebookVisibilitySchema>;

/**
 * Notebook entity (持久化在 Appwrite 的 `notebooks` collection)。
 *
 * 与 AnalysisReport 是不同的实体:
 * - Notebook 由研究员主动发起 (一个 question + AI 报告), 生命周期由研究员控制。
 * - AnalysisReport 由 session 完成自动生成 (scope=session) 或聚合产出 (scope=survey)。
 *
 * 详见 docs/adr/0003-analysis-report-architecture.md 的 D2 决策 (footnote 提到
 * 现已 rename 为 Notebook + 改 ProseMirror content)。
 *
 * D10 决策: Notebook 由 Morris 创建即只读, 不引入 version / lastModifiedAt /
 * lastModifiedBy 字段; 研究员不满意时通过 Morris 对话生成一份**全新** Notebook。
 *
 * Wave B 字段集 (本文件当前形态):
 * - 旧字段 (Wave A): $id / studyId / studyTitle / question / headline / summary
 *   / confidence / sampleSize / report / ownerUserId / createdAt
 * - 新字段 (Wave B): shortId / content (ProseMirror JSON) / textContent (plain mirror)
 *   / visibility / embedding / embeddingModel
 * - report 改为 nullable (旧数据 fallback, Wave F cleanup 删除)
 *
 * 各字段含义见 .kiro/specs/notebooks/design.md §4.1。
 */
export const NotebookSchema = z.object({
  $id: z.string(),
  studyId: z.string(),
  studyTitle: z.string(),
  question: z.string(),
  ownerUserId: z.string(),
  // shortId: 12 字符 alphanumeric URL-friendly id, unique within owner.
  // 由 lib/notebooks/short-id.ts::generateShortId 生成。Wave A 数据用空字符串,
  // 后端 lazy 补 (P-NB-01b 锁定)。
  shortId: z.string().regex(/^[a-z0-9]{0,12}$/).default(""),
  // ProseMirror JSON 文档(Wave B 起 Morris createNotebook 写入此字段)。
  content: z.string().default(""),
  // textContent: ProseMirror 文档抽出的 plain text, 用于 fulltext 检索 + embedding。
  textContent: z.string().default(""),
  // 卡片视图用的"快速字段", 与 report 里的 headline / directAnswer / confidence
  // 冗余存储 — 是为了卡片列表查询无需展开 report jsonb / content ProseMirror。
  headline: z.string(),
  summary: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  sampleSize: z.number().int().nonnegative(),
  // R6 分享: internal (只 owner 可见) | shared (可生成分享 token)
  visibility: NotebookVisibilitySchema.default("internal"),
  // 1024 维 embedding (Qwen DashScope text-embedding-v3) JSON-serialized number[]
  embedding: z.string().default(""),
  embeddingModel: z.string().default(""),
  // 完整论证报告 (旧 fixed-schema fallback). Wave D 起新写入 null,
  // Wave F cleanup commit 从 schema + contracts 删除。
  report: notebookReportSchema.nullable().default(null),
  createdAt: z.string().datetime(),
});

export type Notebook = z.infer<typeof NotebookSchema>;
