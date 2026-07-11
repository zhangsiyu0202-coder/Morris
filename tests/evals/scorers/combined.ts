import type { Scorer, ScoringResult } from "./_types";
import { jsonShapeMatchScorer } from "./jsonShapeMatch";
import { judgeRubricScorer, type JudgeRubricExpected } from "./judgeRubric";
import { scoreScorersInOrder } from "./compose";

interface CombinedExpected extends JudgeRubricExpected {
  readonly must_match_schema?: string;
  readonly schema_path?: string;
  readonly must_contain_keywords?: readonly string[];
  readonly must_not_mention_keywords?: readonly string[];
}

export const combinedEvalScorer: Scorer<unknown, unknown, CombinedExpected> = {
  name: "combined-eval-scorer",
  async score(input, output, expected): Promise<ScoringResult> {
    return scoreScorersInOrder({
      input,
      output,
      expected,
      scorers: [
        jsonShapeMatchScorer,
        ...(expected.judge_rubric ? [judgeRubricScorer] : []),
      ],
    });
  },
};
