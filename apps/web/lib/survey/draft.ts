import type { Survey, SurveySection, QuestionBlock, SurveyDraft } from "@merism/contracts";
import { buildSurveyDraft } from "@merism/contracts";

/**
 * 把 Appwrite 的规范化文档(`surveys` + `survey_sections` + `question_blocks`)
 * 组装为编辑态 `SurveyDraft`(纯函数,无 SDK,可单测)。
 *
 * 这是 Web 侧适配器；真正的 canonical codec 在 `@merism/contracts`。
 */

export function assembleSurveyDraft(
  survey: Survey,
  sections: SurveySection[],
  questions: QuestionBlock[],
): SurveyDraft {
  return buildSurveyDraft({ survey, sections, questions });
}
