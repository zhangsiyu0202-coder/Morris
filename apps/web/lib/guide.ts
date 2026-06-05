import { z } from "zod";

/**
 * 访谈 Guide(提纲)的客户端契约。
 *
 * 与 @merism/contracts 的 SurveyDraft 对齐,但用于「编辑态」:
 * - 每个分节/问题带一个稳定的本地 id(便于 React key 与拖拽/增删)。
 * - 字段允许暂时为空(编辑中),保存前由 UI 做必填校验提示。
 *
 * 题型与追问深度直接复用契约里的枚举值,确保后续能无损映射到
 * InterviewRuntimeQuestion 交给 agent 主持访谈。
 */

export const QUESTION_TYPES = [
  "open_ended",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
  "ranking",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  open_ended: "开放问答",
  single_choice: "单选",
  multi_choice: "多选",
  rating: "评分",
  nps: "NPS 量表",
  ranking: "排序",
};

/** 需要候选项的题型。 */
export const TYPES_NEEDING_OPTIONS: QuestionType[] = [
  "single_choice",
  "multi_choice",
  "ranking",
];

export type ProbeLevel = "standard" | "deep";

export const PROBE_LEVEL_LABELS: Record<ProbeLevel, string> = {
  standard: "标准追问",
  deep: "深度追问",
};

export const guideQuestionSchema = z.object({
  id: z.string(),
  questionText: z.string(),
  questionType: z.enum(QUESTION_TYPES),
  probeLevel: z.enum(["standard", "deep"]),
  probeInstruction: z.string().default(""),
  options: z.array(z.string()).default([]),
});

export const guideSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  objective: z.string(),
  questions: z.array(guideQuestionSchema),
});

export const guideSchema = z.object({
  sections: z.array(guideSectionSchema),
});

export type GuideQuestion = z.infer<typeof guideQuestionSchema>;
export type GuideSection = z.infer<typeof guideSectionSchema>;
export type Guide = z.infer<typeof guideSchema>;

export type StudyStatus = "draft" | "live" | "closed";

export const STATUS_LABELS: Record<StudyStatus, string> = {
  draft: "草稿",
  live: "进行中",
  closed: "已结束",
};

/** 生成一个本地唯一 id(编辑态用,保存时一并落库)。 */
export function localId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 空白问题工厂。 */
export function emptyQuestion(): GuideQuestion {
  return {
    id: localId("q"),
    questionText: "",
    questionType: "open_ended",
    probeLevel: "standard",
    probeInstruction: "",
    options: [],
  };
}

/** 空白分节工厂(含一个空问题)。 */
export function emptySection(): GuideSection {
  return {
    id: localId("s"),
    title: "",
    objective: "",
    questions: [emptyQuestion()],
  };
}

/** 统计 guide 的问题总数。 */
export function countQuestions(guide: Guide): number {
  return guide.sections.reduce((sum, s) => sum + s.questions.length, 0);
}

/**
 * 把任意来源(数据库 jsonb / AI 生成)的 guide 规整为合法结构,
 * 并补齐缺失的本地 id,保证编辑器拿到的数据始终可用。
 */
export function normalizeGuide(raw: unknown): Guide {
  const parsed = guideSchema.safeParse(raw);
  if (parsed.success) {
    return {
      sections: parsed.data.sections.map((s) => ({
        ...s,
        id: s.id || localId("s"),
        questions: s.questions.map((q) => ({ ...q, id: q.id || localId("q") })),
      })),
    };
  }
  return { sections: [] };
}
