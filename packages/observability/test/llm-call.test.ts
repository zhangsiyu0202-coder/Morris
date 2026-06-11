import { describe, it, expect, afterEach } from "vitest";
import {
  LLMCallEventSchema,
  LLMCallStatus,
  LLMCallProvider,
  LLM_CALL_SCOPE_RE,
  installLLMCallSink,
  resetLLMCallSink,
  sinkOrDefault,
  type LLMCallEvent,
  type LLMCallSink,
} from "../src/llm-call.js";

const validBaseEvent: LLMCallEvent = {
  scope: "morris.tool.analyzeData",
  model: "deepseek-chat",
  provider: "deepseek",
  status: "success",
  latencyMs: 423,
  inputTokens: 120,
  outputTokens: 45,
  totalTokens: 165,
  traceId: "trace-abc-123",
  attempt: 0,
};

afterEach(() => resetLLMCallSink());

describe("K-LLMOBS-01: LLMCallEventSchema 自洽", () => {
  it("parses a fully-populated valid event", () => {
    const parsed = LLMCallEventSchema.parse(validBaseEvent);
    expect(parsed).toEqual(validBaseEvent);
  });

  it("parse → stringify → parse is idempotent", () => {
    const a = LLMCallEventSchema.parse(validBaseEvent);
    const b = LLMCallEventSchema.parse(JSON.parse(JSON.stringify(a)));
    expect(b).toEqual(a);
  });

  it("strict — rejects unknown extra field", () => {
    const r = LLMCallEventSchema.safeParse({ ...validBaseEvent, foo: "bar" });
    expect(r.success).toBe(false);
  });
});

describe("K-LLMOBS-02: status enum", () => {
  it.each(["success", "error", "rate_limit", "timeout"] as const)(
    "accepts %s",
    (s) => {
      expect(LLMCallStatus.parse(s)).toBe(s);
    },
  );

  it("rejects unknown status", () => {
    const r = LLMCallEventSchema.safeParse({ ...validBaseEvent, status: "weird" });
    expect(r.success).toBe(false);
  });
});

describe("K-LLMOBS-04: provider lock", () => {
  it("accepts deepseek", () => {
    expect(LLMCallProvider.parse("deepseek")).toBe("deepseek");
  });

  it("rejects other providers (ADR-0002)", () => {
    const r = LLMCallEventSchema.safeParse({ ...validBaseEvent, provider: "openai" });
    expect(r.success).toBe(false);
  });
});

describe("K-LLMOBS-05: scope naming format", () => {
  it.each([
    "morris.tool.analyzeData",
    "morris.compaction.summarize",
    "morris.toolloop",
    "morris.toolloop.reasoner",
    "function.analyzeSession.text-pass",
    "function.analyzeSurvey.rollup",
    "action.notebooks.generateReport",
  ])("accepts %s", (scope) => {
    expect(LLM_CALL_SCOPE_RE.test(scope)).toBe(true);
    expect(LLMCallEventSchema.safeParse({ ...validBaseEvent, scope }).success).toBe(true);
  });

  it.each([
    "MorrisToolloop",          // capitalized prefix
    "wrong.foo",                // wrong prefix
    "morris.",                  // dangling dot
    "morris..tool",             // empty segment
    "morris.123tool",           // segment starts with digit
    "",
  ])("rejects %s", (scope) => {
    expect(LLM_CALL_SCOPE_RE.test(scope)).toBe(false);
    expect(LLMCallEventSchema.safeParse({ ...validBaseEvent, scope }).success).toBe(false);
  });
});

describe("K-LLMOBS-06: secret masking — default sink does not see prompt/completion", () => {
  it("event does NOT contain a prompt field", () => {
    const r = LLMCallEventSchema.parse(validBaseEvent);
    expect(JSON.stringify(r)).not.toContain("\"prompt\"");
    expect(JSON.stringify(r)).not.toContain("\"completion\"");
    expect(JSON.stringify(r)).not.toContain("\"messages\"");
  });
});

describe("Sink installation", () => {
  it("installLLMCallSink swaps active sink and returns restore", () => {
    const captured: LLMCallEvent[] = [];
    const sink: LLMCallSink = (e) => captured.push(e);
    const restore = installLLMCallSink(sink);
    sinkOrDefault(validBaseEvent);
    expect(captured).toHaveLength(1);
    expect(captured[0].scope).toBe("morris.tool.analyzeData");
    restore();
    sinkOrDefault({ ...validBaseEvent, traceId: "after-restore" });
    expect(captured).toHaveLength(1); // restore stops capturing
  });

  it("resetLLMCallSink falls back to default", () => {
    const captured: LLMCallEvent[] = [];
    installLLMCallSink((e) => captured.push(e));
    resetLLMCallSink();
    sinkOrDefault(validBaseEvent);
    expect(captured).toHaveLength(0);
  });
});
