/**
 * Eval harness runner.
 *
 * Two entry points:
 *
 *   `runEval(opts)`    — pure orchestrator. Takes surfaces / scorers /
 *                        rows directly. Called from unit tests with
 *                        deterministic fake surfaces.
 *
 *   `runEvalsCli()`    — CLI entry. Checks MERISM_EVAL_TESTS, walks
 *                        `tests/evals/corpus/`, builds the standard
 *                        surface + scorer wiring, calls runEval, writes
 *                        report. Invoked by `pnpm test:evals`.
 *
 * Env gate: MERISM_EVAL_TESTS MUST equal the strict literal "1" (per the
 * convention in `errors-and-observability.md` § Feature flags). Any
 * other value — including "true", "yes", empty — means evals are off.
 */
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { ScenarioRowSchema, type EvalReport, type EvalReportEntry } from "./schemas";
import type { Scorer } from "../scorers/_types";
import type { SurfaceAdapter } from "../surfaces/_types";
import { writeReport } from "./report";

// NOTE: surface adapters and the default scorer are dynamically
// imported in `runEvalsCli()` so that `runEval()` (the pure orchestrator)
// can be exercised by unit tests without dragging in `ai` /
// `@ai-sdk/deepseek` / `@merism/contracts` at module load.

/** Strict-literal env gate per `.kiro/steering/errors-and-observability.md` § Feature flags. */
export function isEvalsEnabled(): boolean {
  return process.env.MERISM_EVAL_TESTS === "1";
}

/** Max total tokens per run, configurable for ops emergencies via env. Default 500k. */
function maxTokensPerRun(): number {
  const raw = process.env.MERISM_EVAL_MAX_TOKENS_PER_RUN;
  if (!raw) return 500_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500_000;
}

/** Default per-scenario cap; scenarios exceeding this fail with "cost-exceeded". */
const PER_SCENARIO_MAX_TOKENS = 20_000;

export interface RunEvalOptions {
  /** Surface name → adapter mapping. */
  surfaces: ReadonlyMap<string, SurfaceAdapter<unknown, unknown>>;
  /** Scorer to apply to every scenario (single scorer for sub-PR 1; routed by row in later PRs). */
  scorer: Scorer<unknown, unknown, Record<string, unknown>>;
  /** Pre-parsed scenario rows from the corpus. */
  rows: readonly unknown[];
  /** Override token caps for tests. */
  maxTokensPerRunOverride?: number;
  /** Override per-scenario cap for tests. */
  perScenarioMaxTokens?: number;
}

export async function runEval(opts: RunEvalOptions): Promise<EvalReport> {
  const startedAt = new Date();
  const entries: EvalReportEntry[] = [];
  let cumInputTokens = 0;
  let cumOutputTokens = 0;
  const cap = opts.maxTokensPerRunOverride ?? maxTokensPerRun();
  const perCap = opts.perScenarioMaxTokens ?? PER_SCENARIO_MAX_TOKENS;
  let aborted = false;

  for (const raw of opts.rows) {
    const parsed = ScenarioRowSchema.safeParse(raw);
    if (!parsed.success) {
      entries.push({
        id: "<unparseable>",
        surface: "<unknown>",
        tag: "<unknown>",
        ok: false,
        reason: `corpus row failed schema: ${parsed.error.issues
          .map((i) => i.message)
          .slice(0, 2)
          .join("; ")}`,
        tokens: { input: 0, output: 0 },
        durationMs: 0,
      });
      continue;
    }

    const row = parsed.data;

    if (aborted) {
      entries.push({
        id: row.id,
        surface: row.surface,
        tag: row.tag,
        ok: false,
        reason: "skipped: run-wide token ceiling reached on a prior scenario",
        tokens: { input: 0, output: 0 },
        durationMs: 0,
      });
      continue;
    }

    const surface = opts.surfaces.get(row.surface);
    if (!surface) {
      entries.push({
        id: row.id,
        surface: row.surface,
        tag: row.tag,
        ok: false,
        reason: `no surface adapter registered for "${row.surface}"`,
        tokens: { input: 0, output: 0 },
        durationMs: 0,
      });
      continue;
    }

    const before = Date.now();
    let output: unknown;
    let invokeFailure: string | null = null;
    try {
      output = await surface.invoke(row.input);
    } catch (err) {
      invokeFailure = err instanceof Error ? err.message : String(err);
    }
    const invokeMs = Date.now() - before;

    if (invokeFailure !== null) {
      entries.push({
        id: row.id,
        surface: row.surface,
        tag: row.tag,
        ok: false,
        reason: `surface invoke threw: ${invokeFailure}`,
        tokens: { input: 0, output: 0 },
        durationMs: invokeMs,
      });
      continue;
    }

    const scoring = await opts.scorer.score(row.input, output, row.expected as Record<string, unknown>);

    cumInputTokens += scoring.tokens.input;
    cumOutputTokens += scoring.tokens.output;

    // per-scenario cap check
    const scenarioTotal = scoring.tokens.input + scoring.tokens.output;
    if (scenarioTotal > perCap) {
      entries.push({
        id: row.id,
        surface: row.surface,
        tag: row.tag,
        ok: false,
        reason: `cost-exceeded: scenario used ${scenarioTotal} tokens (cap ${perCap})`,
        tokens: scoring.tokens,
        durationMs: Date.now() - before,
      });
    } else {
      entries.push({
        id: row.id,
        surface: row.surface,
        tag: row.tag,
        ok: scoring.ok,
        ...(scoring.ok ? {} : { reason: scoring.reason }),
        tokens: scoring.tokens,
        durationMs: Date.now() - before,
      });
    }

    // run-wide cap check
    if (cumInputTokens + cumOutputTokens > cap) {
      aborted = true;
    }
  }

  return aggregateReport(entries, startedAt, { cumInputTokens, cumOutputTokens });
}

function aggregateReport(
  entries: EvalReportEntry[],
  startedAt: Date,
  totals: { cumInputTokens: number; cumOutputTokens: number },
): EvalReport {
  const passed = entries.filter((e) => e.ok).length;
  const failed = entries.length - passed;
  const skipped = entries.filter((e) => e.reason?.startsWith("skipped:")).length;

  const perSurface: Record<string, { passed: number; failed: number; passRate: number }> = {};
  const perTag: Record<string, { passed: number; failed: number; passRate: number }> = {};
  for (const e of entries) {
    const sBucket = (perSurface[e.surface] ??= { passed: 0, failed: 0, passRate: 0 });
    const tBucket = (perTag[e.tag] ??= { passed: 0, failed: 0, passRate: 0 });
    if (e.ok) {
      sBucket.passed++;
      tBucket.passed++;
    } else {
      sBucket.failed++;
      tBucket.failed++;
    }
  }
  for (const bucket of [...Object.values(perSurface), ...Object.values(perTag)]) {
    const total = bucket.passed + bucket.failed;
    bucket.passRate = total === 0 ? 0 : bucket.passed / total;
  }

  return {
    recordedAt: startedAt.toISOString(),
    totalScenarios: entries.length,
    passed,
    failed: failed - skipped,
    skipped,
    totalTokens: { input: totals.cumInputTokens, output: totals.cumOutputTokens },
    perSurface,
    perTag,
    entries,
  };
}

// --- CLI ----------------------------------------------------------------

/** Discover and parse every `.jsonl` row under `tests/evals/corpus/`. */
async function loadCorpus(corpusRoot: string): Promise<unknown[]> {
  const out: unknown[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const text = readFileSync(full, "utf8");
        for (const [i, line] of text.split("\n").entries()) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("//")) continue;
          try {
            out.push(JSON.parse(trimmed));
          } catch (err) {
            throw new Error(
              `corpus parse error at ${relative(process.cwd(), full)}:${i + 1}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
    }
  }
  await walk(corpusRoot);
  return out;
}

export async function runEvalsCli(): Promise<number> {
  if (!isEvalsEnabled()) {
    console.log("[evals] skipped: MERISM_EVAL_TESTS != \"1\" — set the strict literal \"1\" to run evals.");
    return 0;
  }

  // Dynamic imports keep heavy deps (`ai` / `@ai-sdk/deepseek` /
  // `@merism/contracts` via schemaRegistry) out of the runner's static
  // module graph — tests that exercise runEval() with fake surfaces
  // don't need provider SDKs or the contracts dist installed.
  const { createStudyDraftSurface } = await import("../surfaces/createStudyDraft");
  const { jsonShapeMatchScorer } = await import("../scorers/jsonShapeMatch");

  const surfaces = new Map<string, SurfaceAdapter<unknown, unknown>>([
    [createStudyDraftSurface.name, createStudyDraftSurface as SurfaceAdapter<unknown, unknown>],
  ]);

  const corpusRoot = join(process.cwd(), "tests", "evals", "corpus");
  const rows = await loadCorpus(corpusRoot);

  const report = await runEval({
    surfaces,
    scorer: jsonShapeMatchScorer as Scorer<unknown, unknown, Record<string, unknown>>,
    rows,
  });

  writeReport(report);

  // Print a one-line summary for CI log readability.
  const passRate = report.totalScenarios === 0 ? 0 : report.passed / report.totalScenarios;
  console.log(
    `[evals] ${report.passed}/${report.totalScenarios} passed (${(passRate * 100).toFixed(0)}%), ` +
      `${report.failed} failed, ${report.skipped} skipped, ` +
      `tokens: in=${report.totalTokens.input}, out=${report.totalTokens.output}`,
  );

  return report.failed === 0 ? 0 : 1;
}

// When executed directly via `tsx tests/evals/harness/runner.ts`:
if (import.meta.url === `file://${process.argv[1]}`) {
  runEvalsCli().then((code) => process.exit(code));
}
