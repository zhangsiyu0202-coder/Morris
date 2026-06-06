"use server";

import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from "zod";
import {
  QUESTION_TYPES,
  type GuideSection,
  type GuideQuestion,
  localId,
} from "@/lib/guide";

// 与 Morris AI / 洞察引擎一致:直连 DeepSeek。
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

// AI 输出的问题结构(不含本地 id,落地时再补)。
const aiQuestionSchema = z.object({
  questionText: z.string().describe("问题文本,口语化、适合访谈中朗读"),
  questionType: z.enum(QUESTION_TYPES).describe("题型"),
  probeLevel: z.enum(["standard", "deep"]).describe("追问深度"),
  probeInstruction: z.string().describe("给主持人的追问指令,可为空字符串"),
  options: z.array(z.string()).describe("选项,仅选择/排序题需要,否则空数组"),
});

const aiSectionSchema = z.object({
  title: z.string().describe("分节标题"),
  objective: z.string().describe("这一节想达成的研究目标"),
  questions: z.array(aiQuestionSchema).min(1),
});

const aiGuideSchema = z.object({
  sections: z.array(aiSectionSchema).min(1),
});

function withIds(sections: z.infer<typeof aiSectionSchema>[]): GuideSection[] {
  return sections.map((s) => ({
    id: localId("s"),
    title: s.title,
    objective: s.objective,
    questions: s.questions.map(toGuideQuestion),
  }));
}

function toGuideQuestion(q: z.infer<typeof aiQuestionSchema>): GuideQuestion {
  return {
    id: localId("q"),
    questionText: q.questionText,
    questionType: q.questionType,
    probeLevel: q.probeLevel,
    probeInstruction: q.probeInstruction ?? "",
    options: Array.isArray(q.options) ? q.options : [],
    allowSkip: false,
  };
}

const GUIDE_SYSTEM = `你是 Morris 的访谈提纲设计专家。你为定性用户研究设计结构化的访谈提纲。
原则:
- 按研究目标拆分 2-4 个有逻辑递进的分节(从宽泛/暖场到具体/评价)。
- 每节 2-4 个问题。多数问题用 open_ended 以获取深度;适度搭配 single_choice / multi_choice / rating / nps / ranking。
- 选择类/排序类题必须给出至少 2 个互斥且贴切的选项;开放题 options 留空数组。
- 关键问题用 deep 追问,并在 probeInstruction 写明追问方向。
- 全程中文,问题口语化、适合主持人朗读,不带编号。`;

/** 根据研究主题/目标/受众,生成一整份访谈提纲。 */
export async function generateGuide(input: {
  title: string;
  researchGoal: string;
  targetAudience: string;
}): Promise<{ sections: GuideSection[] } | { error: string }> {
  const title = (input.title ?? "").trim();
  const goal = (input.researchGoal ?? "").trim();
  const audience = (input.targetAudience ?? "").trim();

  if (!title && !goal) {
    return { error: "请先填写调研标题或研究目标,AI 才能生成提纲。" };
  }

  try {
    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 2,
      experimental_output: Output.object({ schema: aiGuideSchema }),
      system: GUIDE_SYSTEM,
      prompt: `请为以下调研设计一份完整的访谈提纲:
标题:${title || "(未填写)"}
研究目标:${goal || "(未填写)"}
目标受众:${audience || "(未填写)"}`,
    });

    if (!experimental_output?.sections?.length) {
      return { error: "AI 未能生成有效提纲,请重试。" };
    }
    return { sections: withIds(experimental_output.sections) };
  } catch (err) {
    console.error("[v0] generateGuide failed:", err);
    return { error: "生成提纲时出错,请稍后重试。" };
  }
}

/** 为某个已有分节扩充 2-3 个新问题(结合该节标题与目标)。 */
export async function expandSection(input: {
  studyTitle: string;
  sectionTitle: string;
  sectionObjective: string;
  existingQuestions: string[];
}): Promise<{ questions: GuideQuestion[] } | { error: string }> {
  try {
    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 2,
      experimental_output: Output.object({
        schema: z.object({ questions: z.array(aiQuestionSchema).min(1).max(4) }),
      }),
      system: GUIDE_SYSTEM,
      prompt: `调研:${input.studyTitle || "(未填写)"}
分节标题:${input.sectionTitle || "(未填写)"}
分节目标:${input.sectionObjective || "(未填写)"}
该节已有问题:
${input.existingQuestions.length ? input.existingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(暂无)"}

请为这一节再补充 2-3 个不重复、能深化该节目标的问题。`,
    });

    if (!experimental_output?.questions?.length) {
      return { error: "AI 未能生成新问题,请重试。" };
    }
    return { questions: experimental_output.questions.map(toGuideQuestion) };
  } catch (err) {
    console.error("[v0] expandSection failed:", err);
    return { error: "扩充问题时出错,请稍后重试。" };
  }
}
