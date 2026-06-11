import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import {
  installLLMCallSink,
  resetLLMCallSink,
  type LLMCallEvent,
} from "../../../packages/observability/src/llm-call.js";
import { withLLMCall } from "../../../packages/observability/src/with-llm-call.js";
import { TransientProviderError } from "../../../packages/observability/src/retry.js";

const captured: LLMCallEvent[] = [];

afterEach(() => {
  resetLLMCallSink();
  captured.length = 0;
});

describe("P-LLMOBS-02: attempt counter forwards faithfully", () => {
  it("withLLMCall preserves attempt across success and error paths", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        fc.boolean(), // success or error
        async (attempt, succeed) => {
          captured.length = 0;
          installLLMCallSink((e) => captured.push(e));
          if (succeed) {
            await withLLMCall(
              {
                scope: "function.analyzeSession.text-pass",
                traceId: "t",
                attempt,
                defaultModel: "deepseek-chat",
              },
              async () => ({
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                text: "ok",
              }),
            );
          } else {
            await expect(
              withLLMCall(
                {
                  scope: "function.analyzeSession.text-pass",
                  traceId: "t",
                  attempt,
                  defaultModel: "deepseek-chat",
                },
                async () => {
                  throw new TransientProviderError("429");
                },
              ),
            ).rejects.toThrow();
          }
          expect(captured).toHaveLength(1);
          expect(captured[0].attempt).toBe(attempt);
          expect(captured[0].attempt).toBeGreaterThanOrEqual(0);
          resetLLMCallSink();
        },
      ),
      { numRuns: 50 },
    );
  });
});
