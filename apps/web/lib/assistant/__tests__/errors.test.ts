import { describe, it, expect } from "vitest";

import { classifyMorrisError, userMessageFor } from "../errors";

describe("classifyMorrisError", () => {
  // ---------- client (4xx 非 401/403/429 + context 类) ----------
  it("classifies HTTP 400 as client", () => {
    const e = Object.assign(new Error("bad request"), { status: 400 });
    expect(classifyMorrisError(e).kind).toBe("client");
  });
  it("classifies HTTP 422 as client", () => {
    const e = Object.assign(new Error("unprocessable"), { status: 422 });
    expect(classifyMorrisError(e).kind).toBe("client");
  });
  it("classifies AI_InvalidArgumentError as client", () => {
    const e = Object.assign(new Error("invalid argument"), { name: "AI_InvalidArgumentError" });
    expect(classifyMorrisError(e).kind).toBe("client");
  });
  it("classifies context length exceeded as client", () => {
    const e = new Error("This model's maximum context length is 32768 tokens");
    expect(classifyMorrisError(e).kind).toBe("client");
  });

  // ---------- api (401/403 + 鉴权类) ----------
  it("classifies HTTP 401 as api", () => {
    const e = Object.assign(new Error("auth"), { status: 401 });
    expect(classifyMorrisError(e).kind).toBe("api");
  });
  it("classifies HTTP 403 as api", () => {
    const e = Object.assign(new Error("forbidden"), { status: 403 });
    expect(classifyMorrisError(e).kind).toBe("api");
  });
  it("classifies api key error as api", () => {
    const e = new Error("Invalid API key provided");
    expect(classifyMorrisError(e).kind).toBe("api");
  });
  it("classifies model_not_found code as api (overrides 4xx status)", () => {
    const e = Object.assign(new Error("Model deepseek-foo does not exist"), {
      status: 400,
      code: "model_not_found",
    });
    expect(classifyMorrisError(e).kind).toBe("api");
  });

  // ---------- transient (429/5xx + rate/timeout/overloaded) ----------
  it("classifies HTTP 429 as transient", () => {
    const e = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(classifyMorrisError(e).kind).toBe("transient");
  });
  it("classifies HTTP 502 as transient", () => {
    const e = Object.assign(new Error("bad gateway"), { status: 502 });
    expect(classifyMorrisError(e).kind).toBe("transient");
  });
  it("classifies AbortError as transient", () => {
    const e = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyMorrisError(e).kind).toBe("transient");
  });
  it("classifies overloaded as transient", () => {
    const e = new Error("server is overloaded");
    expect(classifyMorrisError(e).kind).toBe("transient");
  });

  // ---------- transport ----------
  it("classifies fetch failed as transport", () => {
    const e = Object.assign(new TypeError("fetch failed"), { name: "TypeError" });
    expect(classifyMorrisError(e).kind).toBe("transport");
  });
  it("classifies ECONNRESET as transport", () => {
    const e = Object.assign(new Error("socket"), { code: "ECONNRESET" });
    expect(classifyMorrisError(e).kind).toBe("transport");
  });
  it("classifies ENOTFOUND as transport", () => {
    const e = Object.assign(new Error("dns"), { code: "ENOTFOUND" });
    expect(classifyMorrisError(e).kind).toBe("transport");
  });

  // ---------- unknown ----------
  it("falls back to unknown for unrecognised errors", () => {
    expect(classifyMorrisError(null).kind).toBe("unknown");
    expect(classifyMorrisError(undefined).kind).toBe("unknown");
    expect(classifyMorrisError("plain string").kind).toBe("unknown");
    expect(classifyMorrisError(new Error("totally surprising failure")).kind).toBe("unknown");
  });

  // ---------- 不泄漏 stack ----------
  it("does not include stack in detail", () => {
    const e = new Error("with stack");
    e.stack = "at FakeFrame:1:1\nat Other:2:2";
    const m = classifyMorrisError(e);
    expect(m.detail).not.toContain("FakeFrame");
    expect(m.detail).not.toContain("at ");
  });

  // ---------- userMessage 文案 ----------
  it("userMessageFor returns the canonical Chinese copy per kind", () => {
    expect(userMessageFor("client")).toContain("对话");
    expect(userMessageFor("api")).toContain("鉴权");
    expect(userMessageFor("transient")).toContain("稍后");
    expect(userMessageFor("transport")).toContain("网络");
    expect(userMessageFor("unknown")).toContain("AI 助手");
  });
});
