import type { Scorer, ScoringResult, TokenUsage } from "./_types";

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
  };
}

/**
 * Run scorers in order, accumulate token usage, and short-circuit on the
 * first failure. If any passing scorer marks judgeFlake, the composed result
 * preserves that flag.
 */
export async function scoreScorersInOrder<Input, Output, Expected>(args: {
  input: Input;
  output: Output;
  expected: Expected;
  scorers: readonly Scorer<Input, Output, Expected>[];
}): Promise<ScoringResult> {
  let tokens: TokenUsage = { input: 0, output: 0 };
  let judgeFlake = false;

  for (const scorer of args.scorers) {
    const result = await scorer.score(args.input, args.output, args.expected);
    tokens = addTokens(tokens, result.tokens);
    judgeFlake ||= Boolean(result.judgeFlake);

    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        tokens,
        ...(judgeFlake ? { judgeFlake: true } : {}),
      };
    }
  }

  return {
    ok: true,
    tokens,
    ...(judgeFlake ? { judgeFlake: true } : {}),
  };
}
