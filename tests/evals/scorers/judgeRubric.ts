import { z } from "zod";

import type { Scorer, ScoringResult, TokenUsage } from "./_types";

export interface JudgeVerdict {
  readonly pass: boolean;
  readonly reason: string;
  readonly tokens: TokenUsage;
}

export interface JudgeRubricExpected {
  readonly judge_rubric?: string;
}

export type JudgeRunner = (args: {
  rubric: string;
  input: unknown;
  output: unknown;
  sampleIndex: number;
}) => Promise<JudgeVerdict>;

const JudgeOutputSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1),
});

async function runJudgeSample(args: {
  rubric: string;
  input: unknown;
  output: unknown;
  sampleIndex: number;
}): Promise<JudgeVerdict> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not set — judge scorer requires a real provider key');
  }

  const [{ generateText, Output }, { createDeepSeek }] = await Promise.all([
    import("ai"),
    import("@ai-sdk/deepseek"),
  ]);
  const [{ createLogger, withLLMCall }] = await Promise.all([
    import("@merism/observability"),
  ]);
  const deepseek = createDeepSeek({ apiKey });
  const log = createLogger("function.eval.judge");
  const prompt = [
    "You are grading whether an LLM output satisfies a rubric.",
    "Return only structured JSON.",
    `Rubric: ${args.rubric}`,
    `Input: ${JSON.stringify(args.input)}`,
    `Output: ${JSON.stringify(args.output)}`,
  ].join("\n\n");

  const result = await withLLMCall(
    {
      scope: "function.eval.judge",
      traceId: log.traceId,
      attempt: args.sampleIndex,
      defaultModel: "deepseek-chat",
      prompt,
    },
    () =>
      generateText({
        model: deepseek("deepseek-chat"),
        maxRetries: 1,
        experimental_output: Output.object({ schema: JudgeOutputSchema }),
        system:
          "Grade strictly against the rubric. Pass only when the output clearly satisfies every required condition.",
        prompt,
      }),
  );

  return {
    pass: result.experimental_output?.pass ?? false,
    reason: result.experimental_output?.reason ?? "judge returned no reason",
    tokens: {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
    },
  };
}

export function createJudgeRubricScorer(runJudge: JudgeRunner = runJudgeSample): Scorer<
  unknown,
  unknown,
  JudgeRubricExpected
> {
  return {
    name: "judge-rubric",
    async score(input, output, expected): Promise<ScoringResult> {
      if (!expected.judge_rubric) {
        return { ok: true, tokens: { input: 0, output: 0 } };
      }

      const verdicts = await Promise.all(
        [0, 1, 2].map((sampleIndex) =>
          runJudge({
            rubric: expected.judge_rubric!,
            input,
            output,
            sampleIndex,
          }),
        ),
      );
      const passed = verdicts.filter((verdict) => verdict.pass).length;
      const tokens = verdicts.reduce(
        (acc, verdict) => ({
          input: acc.input + verdict.tokens.input,
          output: acc.output + verdict.tokens.output,
        }),
        { input: 0, output: 0 },
      );
      const judgeFlake = passed > 0 && passed < verdicts.length;
      if (passed >= 2) {
        return { ok: true, tokens, judgeFlake };
      }
      return {
        ok: false,
        reason: verdicts.map((verdict, index) => `sample ${index + 1}: ${verdict.reason}`).join(" | "),
        tokens,
        judgeFlake,
      };
    },
  };
}

export const judgeRubricScorer = createJudgeRubricScorer();
