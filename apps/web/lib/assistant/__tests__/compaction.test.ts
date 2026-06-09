import { describe, it, expect, vi } from "vitest";
import type { UIMessage } from "ai";

import {
  applyCompaction,
  countHumanTurns,
  estimateTokens,
  planCompaction,
  type Summarizer,
} from "../compaction";

function msg(id: string, role: UIMessage["role"], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  } as UIMessage;
}

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("counts text parts (chars/4 rounded up)", () => {
    const m = msg("a", "user", "x".repeat(40)); // 40 chars => 10 tokens
    expect(estimateTokens([m])).toBe(10);
  });

  it("ignores non-text parts", () => {
    const m: UIMessage = {
      id: "a",
      role: "assistant",
      parts: [{ type: "step-start" } as { type: "step-start" }],
    } as UIMessage;
    expect(estimateTokens([m])).toBe(0);
  });
});

describe("countHumanTurns", () => {
  it("counts only user-role messages", () => {
    expect(
      countHumanTurns([msg("a", "user", "x"), msg("b", "assistant", "y"), msg("c", "user", "z")]),
    ).toBe(2);
  });
});

describe("planCompaction", () => {
  const opts = { tokenBudget: 100, minKeepTurns: 3, tailKeep: 4 };

  it("returns noop when human turns ≤ minKeepTurns", () => {
    const ms = [msg("u1", "user", "x"), msg("a1", "assistant", "y"), msg("u2", "user", "x")];
    expect(planCompaction(ms, opts)).toEqual({ action: "noop" });
  });

  it("returns noop when token estimate fits the budget", () => {
    const ms = Array.from({ length: 10 }, (_, i) =>
      msg(`u${i}`, i % 2 === 0 ? "user" : "assistant", "abc"),
    );
    expect(planCompaction(ms, opts)).toEqual({ action: "noop" });
  });

  it("returns compact when over budget and human turns > minKeepTurns", () => {
    const big = "x".repeat(500); // 125 tokens per message
    const ms = Array.from({ length: 10 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", big),
    );
    const plan = planCompaction(ms, opts);
    expect(plan.action).toBe("compact");
    if (plan.action === "compact") {
      expect(plan.keep).toHaveLength(opts.tailKeep);
      expect(plan.dropped).toHaveLength(ms.length - opts.tailKeep);
      // keep 是 messages 的尾部连续子序列
      expect(plan.keep).toEqual(ms.slice(-opts.tailKeep));
      // 不丢失任何条目 (plan 完整性)
      expect([...plan.dropped, ...plan.keep]).toEqual(ms);
    }
  });

  it("returns noop when messages length ≤ tailKeep (no point compacting)", () => {
    const big = "x".repeat(1000);
    const ms = [
      msg("u1", "user", big),
      msg("u2", "user", big),
      msg("u3", "user", big),
      msg("u4", "user", big),
    ];
    expect(planCompaction(ms, { tokenBudget: 50, minKeepTurns: 3, tailKeep: 4 })).toEqual({
      action: "noop",
    });
  });
});

describe("applyCompaction", () => {
  const big = "x".repeat(500);
  const baseMs = Array.from({ length: 10 }, (_, i) =>
    msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", big),
  );
  const opts = { tokenBudget: 100, minKeepTurns: 3, tailKeep: 4 };

  it("returns the same reference for noop", async () => {
    const ms = baseMs.slice(0, 4);
    const plan = planCompaction(ms, opts);
    const summarizer = vi.fn();
    const out = await applyCompaction(ms, plan, summarizer as unknown as Summarizer);
    expect(out).toBe(ms);
    expect(summarizer).not.toHaveBeenCalled();
  });

  it("inserts a system summary message before keep on success", async () => {
    const ms = baseMs;
    const plan = planCompaction(ms, opts);
    const summarizer: Summarizer = async () => "用户在调研 abc 上要求统计 NPS。";
    const out = await applyCompaction(ms, plan, summarizer);
    expect(out.length).toBe(opts.tailKeep + 1);
    expect(out[0].role).toBe("system");
    expect(out.slice(1)).toEqual(ms.slice(-opts.tailKeep));
  });

  it("falls back to placeholder summary when summarizer rejects", async () => {
    const ms = baseMs;
    const plan = planCompaction(ms, opts);
    const summarizer: Summarizer = async () => {
      throw new Error("LLM down");
    };
    const out = await applyCompaction(ms, plan, summarizer);
    expect(out[0].role).toBe("system");
    const summaryText = (out[0].parts[0] as { text: string }).text;
    expect(summaryText).toContain("早期对话已省略");
  });

  it("falls back when summarizer returns empty string", async () => {
    const ms = baseMs;
    const plan = planCompaction(ms, opts);
    const summarizer: Summarizer = async () => "";
    const out = await applyCompaction(ms, plan, summarizer);
    expect(out[0].role).toBe("system");
    const summaryText = (out[0].parts[0] as { text: string }).text;
    expect(summaryText).toContain("早期对话已省略");
  });

  it("token count after compaction is strictly ≤ before", async () => {
    const ms = baseMs;
    const plan = planCompaction(ms, opts);
    const summarizer: Summarizer = async () => "短摘要";
    const out = await applyCompaction(ms, plan, summarizer);
    expect(estimateTokens(out)).toBeLessThanOrEqual(estimateTokens(ms));
  });
});
