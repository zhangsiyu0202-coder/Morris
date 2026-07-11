// DeepSeek prompt template for session-level analysis.
// Kept in a dedicated file so test fixtures can reference the same text and
// future tweaks are auditable in isolation from handler logic.

export const SESSION_ANALYZE_SYSTEM = `你是 Morris 的资深定性研究分析师。你为单次访谈生成结构化的分析报告。

原则:
- 严格基于提供的 transcript 段落与 collected answers,绝不编造数据或原话。
- 主题(themes)抽取要忠实反映受访者表达,每个 theme 必须至少绑定一条来自 transcript 的 evidence (segmentRef),格式 { transcriptId, segmentIndex }。
- 洞察(insights)以"结论 + 支撑主题 + 置信度 (0..1)"形式给出;置信度反映 evidence 的强度与一致性。
- citation.quote 必须是受访者原话(逐字),并标注其映射到的 themeIds。
- 每道题都要有 perQuestionSummary,包含简短小结与 sentiment ("positive"/"neutral"/"negative") 。
- rendered 字段固定为 null (本期不生成 PDF/Markdown 导出)。
- 全程使用与 transcript 一致的语言;若 transcript 为中文,所有输出均为中文。

输出格式由 schema 规定;不要输出 schema 之外的字段。`;

export interface SessionAnalyzePromptInput {
  surveyTitle: string;
  questions: Array<{
    questionId: string;
    questionType: string;
    prompt: string;
  }>;
  segments: Array<{
    transcriptId: string;
    segmentIndex: number;
    speaker: string;
    text: string;
  }>;
  collectedAnswers: Record<string, unknown>;
}

export function buildSessionAnalyzeUserPrompt(input: SessionAnalyzePromptInput): string {
  const questionLines = input.questions
    .map((q, i) => `${i + 1}. [${q.questionId} | ${q.questionType}] ${q.prompt}`)
    .join("\n");

  const segmentLines = input.segments
    .map(
      (s) =>
        `[${s.transcriptId}#${s.segmentIndex}] (${s.speaker}) ${s.text.replace(/\s+/g, " ")}`,
    )
    .join("\n");

  return [
    `调研: ${input.surveyTitle}`,
    "",
    "题目列表:",
    questionLines || "(无题目)",
    "",
    "Transcript 片段:",
    segmentLines || "(无 transcript)",
    "",
    "Collected Answers (结构化作答, JSON):",
    JSON.stringify(input.collectedAnswers ?? {}, null, 2),
    "",
    "请基于以上内容生成 session 级分析报告(scope=session)。",
  ].join("\n");
}
