import { describe, it, expect } from "vitest";
import { createLLMConcurrencyGate } from "../src/concurrency.js";

describe("createLLMConcurrencyGate", () => {
  it("rejects non-positive max", () => {
    expect(() => createLLMConcurrencyGate(0)).toThrow();
    expect(() => createLLMConcurrencyGate(-1)).toThrow();
    expect(() => createLLMConcurrencyGate(NaN)).toThrow();
  });

  it("limits concurrent execution to max", async () => {
    const gate = createLLMConcurrencyGate(2);
    const inflight: number[] = [];
    let peak = 0;
    let running = 0;
    const tasks = Array.from({ length: 6 }, (_, i) =>
      gate(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 10));
        running -= 1;
        inflight.push(i);
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
    expect(inflight).toHaveLength(6);
  });

  it("preserves return value", async () => {
    const gate = createLLMConcurrencyGate(1);
    const out = await gate(async () => 42);
    expect(out).toBe(42);
  });

  it("propagates errors", async () => {
    const gate = createLLMConcurrencyGate(1);
    await expect(gate(async () => { throw new Error("bad"); })).rejects.toThrow("bad");
  });
});
