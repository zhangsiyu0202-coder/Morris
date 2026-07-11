import { describe, expect, it, vi } from "vitest";

import { scoreScorersInOrder } from "../compose";
import type { Scorer } from "../_types";
import { ZERO_TOKENS } from "../_types";

describe("scoreScorersInOrder", () => {
  it("accumulates tokens across passing scorers", async () => {
    const scorers: readonly Scorer<unknown, unknown, unknown>[] = [
      {
        name: "first",
        async score() {
          return { ok: true, tokens: { input: 1, output: 2 } };
        },
      },
      {
        name: "second",
        async score() {
          return { ok: true, tokens: { input: 3, output: 4 } };
        },
      },
    ];

    const result = await scoreScorersInOrder({ input: {}, output: {}, expected: {}, scorers });

    expect(result).toEqual({ ok: true, tokens: { input: 4, output: 6 } });
  });

  it("short-circuits on the first failure", async () => {
    const calls: string[] = [];
    const first: Scorer<unknown, unknown, unknown> = {
      name: "first",
      async score() {
        calls.push("first");
        return { ok: true, tokens: ZERO_TOKENS };
      },
    };
    const second: Scorer<unknown, unknown, unknown> = {
      name: "second",
      async score() {
        calls.push("second");
        return { ok: false, reason: "stop here", tokens: { input: 5, output: 6 } };
      },
    };
    const third = vi.fn<Scorer<unknown, unknown, unknown>["score"]>().mockResolvedValue({
      ok: true,
      tokens: { input: 7, output: 8 },
    });

    const result = await scoreScorersInOrder({
      input: {},
      output: {},
      expected: {},
      scorers: [first, second, { name: "third", score: third }],
    });

    expect(result).toEqual({ ok: false, reason: "stop here", tokens: { input: 5, output: 6 } });
    expect(calls).toEqual(["first", "second"]);
    expect(third).not.toHaveBeenCalled();
  });

  it("preserves judgeFlake when a passing scorer marks it", async () => {
    const scorers: readonly Scorer<unknown, unknown, unknown>[] = [
      {
        name: "first",
        async score() {
          return { ok: true, tokens: { input: 1, output: 0 }, judgeFlake: true };
        },
      },
      {
        name: "second",
        async score() {
          return { ok: true, tokens: { input: 0, output: 2 } };
        },
      },
    ];

    const result = await scoreScorersInOrder({ input: {}, output: {}, expected: {}, scorers });

    expect(result).toEqual({ ok: true, tokens: { input: 1, output: 2 }, judgeFlake: true });
  });
});
