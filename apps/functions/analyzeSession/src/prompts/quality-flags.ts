/**
 * qualityFlags LLM prompt + 输出 schema (analysis-report-v2 R1 / design §5.2).
 *
 * 仅产出 semantic flags 子集 (off-topic / shallow / fluent / deep-engagement /
 * refused-topic);mechanical 子集 (silent / too-short / too-long) 由规则层在
 * `quality-flags.ts::deriveQualityFlagsRule` 决定,不进 LLM。
 */

import { z } from "zod";

import { SessionQualityFlagSchema } from "@merism/contracts";

import type { SurveyContext, TranscriptRecord } from "../handler.js";

const SemanticFlagSchema = z.enum([
  "off-topic",
  "shallow",
  "fluent",
  "deep-engagement",
  "refused-topic",
]);

/** LLM 输出 schema。模型输出 SemanticFlag 的子集; 规则层后续合并 + 互斥裁剪。 */
export const QualityFlagsLLMOutputSchema = z.object({
  flags: z.array(SemanticFlagSchema),
});

export type QualityFlagsLLMOutput = z.infer<typeof QualityFlagsLLMOutputSchema>;

// 互斥说明列在 system prompt, 让模型自身先做一轮规避(虽然落地端还会用 enforceMutex 强制)。
export const QUALITY_FLAGS_SYSTEM = `你是定性研究质量评估助手。给一段访谈 transcript 与题目列表, 你判断这场访谈在内容质量维度的标签。

输出严格 JSON: { "flags": string[] }, 取值集合: ["off-topic", "shallow", "fluent", "deep-engagement", "refused-topic"].

判定规则:
- 受访者答非所问 / 大段闲聊 → off-topic
- 受访者答得短、表层、缺细节 → shallow
- 受访者表达清晰、信息密度高 → fluent
- 受访者真情流露 / 给出可操作建议 → deep-engagement
- 受访者明确拒绝深入某话题 → refused-topic
- 同一访谈可同时含多个标签 (例如 fluent + refused-topic), 但下列对不允许同时出现:
  fluent ∩ shallow

不要输出 schema 之外的字段。不要输出 markdown 代码块包装。`;

export interface QualityFlagsPromptInput {
  surveyTitle: string;
  questions: Array<{ questionId: string; questionType: string; prompt: string }>;
  transcript: Array<{ speaker: string; text: string }>;
}

export function buildQualityFlagsUserPrompt(input: QualityFlagsPromptInput): string {
  const questions = input.questions.length
    ? input.questions
        .map((q, i) => `${i + 1}. [${q.questionId} | ${q.questionType}] ${q.prompt}`)
        .join("\n")
    : "(无题目)";
  const transcript = input.transcript.length
    ? input.transcript.map((s) => `(${s.speaker}) ${s.text.replace(/\s+/g, " ")}`).join("\n")
    : "(无 transcript)";
  return [
    `调研主题: ${input.surveyTitle}`,
    "",
    "题目列表:",
    questions,
    "",
    "Transcript:",
    transcript,
    "",
    "请输出 JSON: { \"flags\": [...] }",
  ].join("\n");
}

/** 把 SurveyContext + TranscriptRecord 折叠成 LLM prompt 的输入。 */
export function buildQualityFlagsPromptInput(args: {
  transcript: TranscriptRecord;
  surveyContext: SurveyContext;
}): QualityFlagsPromptInput {
  return {
    surveyTitle: args.surveyContext.title,
    questions: args.surveyContext.questionBlocks.map((q) => ({
      questionId: q.$id,
      questionType: q.type,
      prompt: q.prompt,
    })),
    transcript: args.transcript.segments.map((s) => ({ speaker: s.speaker, text: s.text })),
  };
}

// Schema 兼容性自检(编译期): SemanticFlag 必须是 SessionQualityFlag 的子集。
type _AssertSubset = z.infer<typeof SemanticFlagSchema> extends z.infer<typeof SessionQualityFlagSchema>
  ? true
  : never;
const _assertSubset: _AssertSubset = true;
void _assertSubset;
