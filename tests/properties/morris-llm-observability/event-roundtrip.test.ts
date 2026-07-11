import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  LLMCallEventSchema,
  type LLMCallEvent,
  LLM_CALL_SCOPE_RE,
} from "../../../packages/observability/src/llm-call.js";

const scopePrefix = fc.constantFrom("morris", "function", "action");
const segment = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => /^[a-zA-Z][\w-]*$/.test(s));

const scopeArb = fc
  .tuple(scopePrefix, fc.array(segment, { minLength: 1, maxLength: 4 }))
  .map(([head, segs]) => `${head}.${segs.join(".")}`)
  .filter((s) => LLM_CALL_SCOPE_RE.test(s));

const usageArb = fc.record({
  inputTokens: fc.integer({ min: 0, max: 100_000 }),
  outputTokens: fc.integer({ min: 0, max: 100_000 }),
});

const statusArb = fc.constantFrom("success", "error", "rate_limit", "timeout");

const eventArb: fc.Arbitrary<LLMCallEvent> = fc
  .record({
    scope: scopeArb,
    model: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
    provider: fc.constant("deepseek" as const),
    status: statusArb,
    latencyMs: fc.integer({ min: 0, max: 60_000 }),
    usage: usageArb,
    traceId: fc.uuid(),
    attempt: fc.integer({ min: 0, max: 5 }),
  })
  .map(({ usage, ...rest }) => ({
    ...rest,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
  } as LLMCallEvent));

describe("P-LLMOBS-01: LLMCallEvent schema round-trip", () => {
  it("any valid event survives parse → stringify → parse identically", () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const parsed = LLMCallEventSchema.parse(event);
        const roundTripped = LLMCallEventSchema.parse(JSON.parse(JSON.stringify(parsed)));
        expect(roundTripped).toEqual(parsed);
      }),
      { numRuns: 100 },
    );
  });

  it("scope passing the regex always parses", () => {
    fc.assert(
      fc.property(scopeArb, eventArb, (scope, e) => {
        const parsed = LLMCallEventSchema.parse({ ...e, scope });
        expect(parsed.scope).toBe(scope);
      }),
      { numRuns: 50 },
    );
  });

  it("scope failing the regex always rejects", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !LLM_CALL_SCOPE_RE.test(s)),
        eventArb,
        (badScope, e) => {
          const r = LLMCallEventSchema.safeParse({ ...e, scope: badScope });
          expect(r.success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
