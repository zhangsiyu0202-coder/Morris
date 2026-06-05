import { pgTable, uuid, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Study(调研)——以 study 为核心的实体。每个 study 拥有一份访谈 guide
 * (提纲),guide 以 jsonb 存储分节 → 问题的嵌套结构,与 @merism/contracts
 * 的 SurveyDraft 对齐(GuideDraft 类型见 lib/guide.ts)。
 *
 * 当前应用无鉴权,故不做 userId 作用域;后续接入登录时再补充。
 */
export const study = pgTable("study", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"), // draft | live | closed
  researchGoal: text("research_goal").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  introScript: text("intro_script").notNull().default(""),
  // 访谈 guide:{ sections: [{ id, title, objective, questions: [...] }] }
  guide: jsonb("guide").notNull().default({ sections: [] }),
  responses: integer("responses").notNull().default(0),
  completionRate: real("completion_rate").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StudyRow = typeof study.$inferSelect;
export type NewStudyRow = typeof study.$inferInsert;

/**
 * 自定义洞察。每条记录是一次「针对某个 study 的自定义问题」的深度论证分析,
 * 生成时一次性算好完整报告并落库,详情页直接读取展示。
 *
 * 注意:当前应用尚无鉴权,因此不做 userId 作用域。后续若接入登录,
 * 应补充 userId 列并在每个查询中按用户过滤。
 */
export const insight = pgTable("insight", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: text("study_id").notNull(),
  studyTitle: text("study_title").notNull(),
  question: text("question").notNull(),
  // 列表卡片用的简要字段
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  confidence: text("confidence").notNull(), // high | medium | low
  sampleSize: integer("sample_size").notNull(),
  // 完整论证报告(结论在先 + 证据支撑),结构见 lib/insights.ts 的 DeepAnalysis
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsightRow = typeof insight.$inferSelect;
export type NewInsightRow = typeof insight.$inferInsert;
