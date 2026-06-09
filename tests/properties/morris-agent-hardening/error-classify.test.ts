import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { classifyMorrisError, type MorrisErrorKind } from "../../../apps/web/lib/assistant/errors";

/**
 * P-AI-04 — 错误分类互斥覆盖
 *
 * 对预设错误样本表 (≥20 例), 每个样本的分类落在 5 类之一且与人工标注一致;
 * shuffle 顺序不影响判定。
 */

interface Sample {
  desc: string;
  err: () => unknown;
  expected: MorrisErrorKind;
}

const SAMPLES: Sample[] = [
  // ---- client ----
  { desc: "HTTP 400 bad request", err: () => Object.assign(new Error("bad"), { status: 400 }), expected: "client" },
  { desc: "HTTP 422 unprocessable", err: () => Object.assign(new Error("uno"), { status: 422 }), expected: "client" },
  { desc: "AI_InvalidArgumentError", err: () => Object.assign(new Error("invalid"), { name: "AI_InvalidArgumentError" }), expected: "client" },
  { desc: "context length exceeded", err: () => new Error("Maximum context length is 32k"), expected: "client" },
  { desc: "tool_use_failed", err: () => new Error("tool_use_failed: bad input"), expected: "client" },
  // ---- api ----
  { desc: "HTTP 401 unauthorized", err: () => Object.assign(new Error("auth"), { status: 401 }), expected: "api" },
  { desc: "HTTP 403 forbidden", err: () => Object.assign(new Error("forbidden"), { status: 403 }), expected: "api" },
  { desc: "Invalid API key", err: () => new Error("Invalid API key"), expected: "api" },
  { desc: "model_not_found code", err: () => Object.assign(new Error("Model x does not exist"), { status: 400, code: "model_not_found" }), expected: "api" },
  { desc: "permission_denied", err: () => new Error("permission_denied: scope"), expected: "api" },
  // ---- transient ----
  { desc: "HTTP 429 rate limit", err: () => Object.assign(new Error("rate"), { status: 429 }), expected: "transient" },
  { desc: "HTTP 500 server error", err: () => Object.assign(new Error("oops"), { status: 500 }), expected: "transient" },
  { desc: "HTTP 502 bad gateway", err: () => Object.assign(new Error("bad gateway"), { status: 502 }), expected: "transient" },
  { desc: "AbortError (timeout)", err: () => Object.assign(new Error("aborted"), { name: "AbortError" }), expected: "transient" },
  { desc: "overloaded", err: () => new Error("server is overloaded"), expected: "transient" },
  { desc: "timed out", err: () => new Error("request timed out"), expected: "transient" },
  // ---- transport ----
  { desc: "fetch failed (TypeError)", err: () => Object.assign(new TypeError("fetch failed"), { name: "TypeError" }), expected: "transport" },
  { desc: "ECONNRESET", err: () => Object.assign(new Error("conn reset"), { code: "ECONNRESET" }), expected: "transport" },
  { desc: "ETIMEDOUT", err: () => Object.assign(new Error("net to"), { code: "ETIMEDOUT" }), expected: "transport" },
  { desc: "ENOTFOUND", err: () => Object.assign(new Error("dns"), { code: "ENOTFOUND" }), expected: "transport" },
  { desc: "ECONNREFUSED", err: () => Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), expected: "transport" },
  // ---- unknown ----
  { desc: "null", err: () => null, expected: "unknown" },
  { desc: "undefined", err: () => undefined, expected: "unknown" },
  { desc: "plain string", err: () => "totally surprising", expected: "unknown" },
  { desc: "vanilla error", err: () => new Error("totally surprising failure"), expected: "unknown" },
];

describe("P-AI-04: classifyMorrisError exclusive + exhaustive sample table", () => {
  it("table has at least 20 entries and covers all 5 kinds", () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(20);
    const kinds = new Set(SAMPLES.map((s) => s.expected));
    expect(kinds).toEqual(new Set<MorrisErrorKind>(["client", "api", "transient", "transport", "unknown"]));
  });

  it.each(SAMPLES)("%# $desc → $expected", ({ err, expected }) => {
    expect(classifyMorrisError(err()).kind).toBe(expected);
  });

  it("shuffled iteration yields the same classifications", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(SAMPLES, { minLength: SAMPLES.length, maxLength: SAMPLES.length }), (shuffled) => {
        for (const s of shuffled) {
          expect(classifyMorrisError(s.err()).kind).toBe(s.expected);
        }
      }),
    );
  });
});
