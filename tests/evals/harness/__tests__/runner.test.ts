/**
 * Runner unit tests. Use a deterministic fake surface so the runner
 * itself is tested without any LLM call. The CLI's env gate is tested
 * separately by setting / unsetting MERISM_EVAL_TESTS via vi.stubEnv.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runEval, isEvalsEnabled } from "../runner";
import type { Scorer } from "../../scorers/_types";
import type { SurfaceAdapter } from "../../surfaces/_types";
import { ZERO_TOKENS } from "../../scorers/_types";

const fakeSurface: SurfaceAdapter<{ greeting: string }, { greeting: string; len: number }> = {
  name: "fake.echo",
  async invoke(input) {
    return { greeting: input.greeting, len: input.greeting.length };
  },
};

const passScorer: Scorer<unknown, unknown, Record<string, unknown>> = {
  name: "always-pass",
  async score() {
    return { ok: true, tokens: ZERO_TOKENS };
  },
};

const failScorer: Scorer<unknown, unknown, Record<string, unknown>> = {
  name: "always-fail",
  async score() {
    return { ok: false, reason: "deliberately fails for test", tokens: ZERO_TOKENS };
  },
};

describe("isEvalsEnabled", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("returns true for the strict literal \"1\"", () => {
    vi.stubEnv("MERISM_EVAL_TESTS", "1");
    expect(isEvalsEnabled()).toBe(true);
  });

  it("returns false for \"true\", \"yes\", \"on\", empty string, and unset", () => {
    for (const v of ["true", "yes", "on", "TRUE", "0", "", "  "]) {
      vi.stubEnv("MERISM_EVAL_TESTS", v);
      expect(isEvalsEnabled()).toBe(false);
    }
    vi.stubEnv("MERISM_EVAL_TESTS", "");
    expect(isEvalsEnabled()).toBe(false);
  });
});

describe("runEval", () => {
  const surfaces = new Map<string, SurfaceAdapter<unknown, unknown>>([
    [fakeSurface.name, fakeSurface as SurfaceAdapter<unknown, unknown>],
  ]);

  const goodRow = {
    id: "fake-1",
    surface: "fake.echo",
    tag: "happy-path",
    input: { greeting: "hi" },
    expected: { must_match: true },
  };

  it("invokes the surface and records a pass", async () => {
    const report = await runEval({ surfaces, scorer: passScorer, rows: [goodRow] });
    expect(report.totalScenarios).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.entries[0].ok).toBe(true);
    expect(report.entries[0].surface).toBe("fake.echo");
    expect(report.perSurface["fake.echo"].passRate).toBe(1);
    expect(report.perTag["happy-path"].passRate).toBe(1);
  });

  it("records the failure reason on a failed score", async () => {
    const report = await runEval({ surfaces, scorer: failScorer, rows: [goodRow] });
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.entries[0].ok).toBe(false);
    expect(report.entries[0].reason).toContain("deliberately fails");
  });

  it("marks unknown-surface rows as failed without throwing", async () => {
    const row = { ...goodRow, surface: "not.registered" };
    const report = await runEval({ surfaces, scorer: passScorer, rows: [row] });
    expect(report.failed).toBe(1);
    expect(report.entries[0].reason).toContain("no surface adapter registered");
  });

  it("records corpus-parse failures as failed entries", async () => {
    const report = await runEval({
      surfaces,
      scorer: passScorer,
      rows: [{ id: "incomplete-row" /* missing surface, tag, input, expected */ }],
    });
    expect(report.failed).toBe(1);
    expect(report.entries[0].id).toBe("<unparseable>");
    expect(report.entries[0].reason).toContain("corpus row failed schema");
  });

  it("catches surface exceptions and marks scenario failed", async () => {
    const throwingSurface: SurfaceAdapter<unknown, unknown> = {
      name: "fake.throws",
      async invoke() {
        throw new Error("boom");
      },
    };
    const m = new Map<string, SurfaceAdapter<unknown, unknown>>([
      [throwingSurface.name, throwingSurface],
    ]);
    const report = await runEval({
      surfaces: m,
      scorer: passScorer,
      rows: [{ ...goodRow, surface: "fake.throws" }],
    });
    expect(report.failed).toBe(1);
    expect(report.entries[0].reason).toContain("surface invoke threw");
    expect(report.entries[0].reason).toContain("boom");
  });

  it("aborts subsequent scenarios when run-wide token ceiling reached", async () => {
    // High-token scorer: emit 100 input tokens per scenario; cap at 150
    // so the 2nd row blows the ceiling and the 3rd is skipped.
    const heavyScorer: Scorer<unknown, unknown, Record<string, unknown>> = {
      name: "heavy",
      async score() {
        return { ok: true, tokens: { input: 100, output: 0 } };
      },
    };
    const rows = [
      { ...goodRow, id: "row-1" },
      { ...goodRow, id: "row-2" },
      { ...goodRow, id: "row-3" },
    ];
    const report = await runEval({
      surfaces,
      scorer: heavyScorer,
      rows,
      maxTokensPerRunOverride: 150,
    });
    expect(report.entries[0].ok).toBe(true);
    expect(report.entries[1].ok).toBe(true);
    expect(report.entries[2].ok).toBe(false);
    expect(report.entries[2].reason).toContain("skipped: run-wide token ceiling");
    expect(report.skipped).toBe(1);
  });

  it("fails a single scenario that exceeds the per-scenario cap", async () => {
    const heavyScorer: Scorer<unknown, unknown, Record<string, unknown>> = {
      name: "heavy",
      async score() {
        return { ok: true, tokens: { input: 25_000, output: 0 } };
      },
    };
    const report = await runEval({
      surfaces,
      scorer: heavyScorer,
      rows: [goodRow],
      perScenarioMaxTokens: 20_000,
      maxTokensPerRunOverride: 999_999,
    });
    expect(report.failed).toBe(1);
    expect(report.entries[0].reason).toContain("cost-exceeded");
    expect(report.entries[0].reason).toContain("25000");
  });
});
