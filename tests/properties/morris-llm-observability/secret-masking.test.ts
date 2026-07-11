import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fc from "fast-check";
import {
  installLLMCallSink,
  resetLLMCallSink,
  type LLMCallEvent,
} from "../../../packages/observability/src/llm-call.js";
import { withLLMCall } from "../../../packages/observability/src/with-llm-call.js";

const captured: LLMCallEvent[] = [];

beforeEach(() => {
  delete process.env.MERISM_DEBUG_PROVIDERS;
});

afterEach(() => {
  resetLLMCallSink();
  captured.length = 0;
  delete process.env.MERISM_DEBUG_PROVIDERS;
});

describe("P-LLMOBS-03: default sink never sees prompt or completion text", () => {
  it("any prompt/completion never appears in serialized event when debug flag off", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 1000 })
          .map((s) => `__SENTINEL_PROMPT__${s}`),
        fc
          .string({ minLength: 1, maxLength: 1000 })
          .map((s) => `__SENTINEL_COMPLETION__${s}`),
        async (prompt, completion) => {
          captured.length = 0;
          installLLMCallSink((e) => captured.push(e));
          await withLLMCall(
            {
              scope: "action.notebooks.generateReport",
              traceId: "t",
              defaultModel: "deepseek-chat",
              prompt,
            },
            async () => ({
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              text: completion,
            }),
          );
          expect(captured).toHaveLength(1);
          const serialized = JSON.stringify(captured[0]);
          // 字段层面 — debugSnippets 在 default (env unset) 下应 undefined
          expect(captured[0].debugSnippets).toBeUndefined();
          // 序列化层 — 不应包含 prompt 或 completion 的任何 substring
          // (prompt 长度 ≥ 1, 必然不为空)
          expect(serialized.includes(prompt)).toBe(false);
          expect(serialized.includes(completion)).toBe(false);
          resetLLMCallSink();
        },
      ),
      { numRuns: 100 },
    );
  });
});
