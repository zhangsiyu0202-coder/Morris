import type {
  Survey,
  SurveySection,
  QuestionBlock,
  SurveyDraft,
  SurveyDraftQuestion,
  StudyQuestionType,
} from "@merism/contracts";
import { createLogger } from "@merism/observability";

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

function configOptions(config: Record<string, unknown> | undefined): string[] {
  if (!config) return [];
  const v = config.options;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const _log = createLogger("survey.assembleDraft");

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
    moderatorInstruction: survey.moderatorInstruction ?? "",
    // ADR-0015 primary field. Read straight from the Survey column;
    // legacy Survey rows return "" (schema default) and the composer's
    // fallback rebuilds from the four legacy fields at flow-config
    // build time.
    instruction: survey.instruction ?? "",
    sections: orderedSections.map((section) => {
      const sectionQuestions = questions
        .filter((q) => q.sectionId === section.$id)
        .sort((a, b) => a.orderInSection - b.orderInSection)
        .map((block): SurveyDraftQuestion => {
          // `config` and `skipLogic` are typed via QuestionBlockConfigSchema
          // and QuestionBlockSkipLogicSchema (both .passthrough for legacy
          // extra keys). Both go through Appwrite's stringified-JSON wire
          // shape, decoded by the schema's jsonObject preprocess.
          //
          // The typed schemas validate presence + primitive types; the
          // .safeParse in queries/studies.ts::parseQuestion is authoritative
          // for accepting/rejecting the whole row. If a row's skipLogic
          // contained items that failed the inner schema, that row would
          // have been rejected there — so by the time we're here, everything
          // is well-typed.
          //
          // The residual anomaly: pre-existing rows written before this
          // schema tightening MAY have `skipLogic.branchRules` items with
          // extra fields or missing fields. .passthrough allows the extras;
          // missing required fields would fail schema parse upstream. Warn
          // if we see an anomalous shape survive to this point (defensive).
          const stableId = block.config?.stableId;
          const branchRules = block.skipLogic?.branchRules ?? [];

          // Defensive: even though schema validated, catch a schema-typed
          // but semantically-empty rule that should never persist. A
          // legacy row with a partial rule (e.g. condition="" after trim)
          // would have failed .min(1) parse — so this warns on truly
          // impossible cases, aiding forward-compat debugging.
          const validBranchRules = branchRules.filter((r) => {
            const valid =
              typeof r.condition === "string" &&
              r.condition.trim().length > 0 &&
              typeof r.jumpToQuestionId === "string" &&
              r.jumpToQuestionId.length > 0;
            if (!valid) {
              _log.warn("draft.branchRules.dropped_malformed", {
                surveyId: survey.$id,
                questionBlockId: block.$id,
                rule: r,
              });
            }
            return valid;
          });

          return {
            stableId,
            questionText: block.prompt,
            questionType: toDraftQuestionType(block.type),
            probeLevel: block.probeConfig?.level ?? "standard",
            probeInstruction: block.probeConfig?.instruction ?? "",
            options: configOptions(block.config),
            allowSkip: block.config?.allowSkip === true,
            stimulus: block.stimulus,
            branchRules: validBranchRules,
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
