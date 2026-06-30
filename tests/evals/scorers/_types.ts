/**
 * Eval harness type contract — scorer shape + scoring result.
 *
 * A "scorer" takes (input, output, expected) and produces a pass/fail
 * verdict with a human-readable reason. Scorers MUST be deterministic
 * for the same (input, output, expected) triple unless they explicitly
 * call out variance (e.g., judgeRubric scorer in sub-PR 3).
 *
 * Token usage accounting is part of the scorer contract because the
 * scorer is where any judge-model call originates; the runner sums
 * tokens across scorers to enforce the run-wide cost ceiling.
 */

export interface TokenUsage {
  /** Tokens consumed reading input + producing output by any LLM the scorer invokes. */
  readonly input: number;
  readonly output: number;
}

export type ScoringResult =
  | {
      readonly ok: true;
      readonly tokens: TokenUsage;
    }
  | {
      readonly ok: false;
      /** Why the scorer says this output is not acceptable. Surfaces in the report. */
      readonly reason: string;
      readonly tokens: TokenUsage;
    };

export interface Scorer<Input, Output, Expected> {
  /** Unique scorer identifier. */
  readonly name: string;

  /**
   * Score `output` against `expected` given the originating `input`.
   * For deterministic scorers, `tokens` will be `{ input: 0, output: 0 }`
   * because no LLM is invoked.
   */
  score(input: Input, output: Output, expected: Expected): Promise<ScoringResult>;
}

export const ZERO_TOKENS: TokenUsage = Object.freeze({ input: 0, output: 0 });
