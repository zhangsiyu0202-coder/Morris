import { pgTable, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";

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

// Insight has been migrated to Appwrite (analysis-report sub-spec, T8).
// The pgTable definition is intentionally removed. Reads/writes for insights
// now go through `apps/web/lib/queries/insights.ts` and
// `apps/web/lib/actions/insights.ts` against the Appwrite `Insight`
// collection. Drizzle remains in this file only for the editor's `study`
// table until the survey-editor sub-spec migrates that too.
