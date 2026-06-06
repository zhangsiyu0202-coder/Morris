import type {
  Survey,
  SurveySection,
  QuestionBlock,
  SurveyDraft,
  SurveyDraftQuestion,
  StudyQuestionType,
} from "@merism/contracts";

/**
 * 把 Appwrite 的规范化文档(`surveys` + `survey_sections` + `question_blocks`)
 * 组装为编辑态 `SurveyDraft`(纯函数,无 SDK,可单测)。
 *
 * 映射约定见 survey-editor design §4：
 * - draft 顶层 meta(researchGoal/targetAudience/introScript)存于 `Survey.flowConfig`
 * - section.objective ← `SurveySection.description`，按 `order` 排序
 * - 每节问题按 `orderInSection` 排序
 * - question 选项/allowSkip 存于 `QuestionBlock.config`
 *
 * 读取容忍不完整数据(编辑中态),不做 `SurveyDraftSchema` 严格校验。
 */

const DRAFT_QUESTION_TYPES = new Set<string>([
  "open_ended",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
  "ranking",
]);

/** entities `QuestionType` 比 draft 宽(含 text/info);收敛到 draft 题型。 */
function toDraftQuestionType(type: string): StudyQuestionType {
  if (DRAFT_QUESTION_TYPES.has(type)) return type as StudyQuestionType;
  // text / info 等非 draft 题型一律按开放问答处理。
  return "open_ended";
}

function flowString(flowConfig: Record<string, unknown>, key: string): string {
  const v = flowConfig[key];
  return typeof v === "string" ? v : "";
}

function configOptions(config: Record<string, unknown>): string[] {
  const v = config.options;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function assembleSurveyDraft(
  survey: Survey,
  sections: SurveySection[],
  questions: QuestionBlock[],
): SurveyDraft {
  const flow = (survey.flowConfig ?? {}) as Record<string, unknown>;

  const orderedSections = [...sections].sort((a, b) => a.order - b.order);

  return {
    title: survey.title,
    researchGoal: flowString(flow, "researchGoal"),
    targetAudience: flowString(flow, "targetAudience"),
    introScript: flowString(flow, "introScript"),
    sections: orderedSections.map((section) => {
      const sectionQuestions = questions
        .filter((q) => q.sectionId === section.$id)
        .sort((a, b) => a.orderInSection - b.orderInSection)
        .map((block): SurveyDraftQuestion => {
          const config = (block.config ?? {}) as Record<string, unknown>;
          return {
            questionText: block.prompt,
            questionType: toDraftQuestionType(block.type),
            probeLevel: block.probeConfig?.level ?? "standard",
            probeInstruction: block.probeConfig?.instruction ?? "",
            options: configOptions(config),
            allowSkip: config.allowSkip === true,
            stimulus: block.stimulus,
          };
        });

      return {
        title: section.title,
        objective: section.description,
        questions: sectionQuestions,
      };
    }),
  };
}
