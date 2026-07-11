/**
 * Eval harness — runtime schemas.
 *
 * - `ScenarioRowSchema`: corpus `.jsonl` row shape.
 * - `EvalReportSchema`: the JSON written to `tests/evals/reports/`.
 *
 * Both are zod schemas so violations are caught at parse-time with a
 * pointed error path, not at the scoring stage.
 */
import { z } from "zod";

/**
 * One corpus row. `id` is unique per scenario across the entire corpus
 * (the runner refuses to start if duplicates are detected). `expected`
 * is the rubric the scorer reads; its shape depends on the scorer
 * combination this scenario uses.
 */
export const ScenarioRowSchema = z.object({
  /** Stable scenario identifier; unique across the entire corpus. */
  id: z.string().min(1),

  /** Surface name that this scenario targets, e.g. "morris.tool.createStudyDraft". */
  surface: z.string().min(1),

  /** Controlled vocabulary tag from `tests/evals/corpus/tags.yaml`. */
  tag: z.string().min(1),

  /** Input passed to the surface adapter. Shape is surface-specific. */
  input: z.unknown(),

  /** Rubric / expected output. Shape is scorer-specific (see scorers/_types.ts). */
  expected: z.record(z.string(), z.unknown()),

  /** Optional cap override; defaults to per-run constant if unset. */
  maxTokensOverride: z.number().int().positive().optional(),
});
export type ScenarioRow = z.infer<typeof ScenarioRowSchema>;

/** One scored scenario in the report. */
export const EvalReportEntrySchema = z.object({
  id: z.string(),
  surface: z.string(),
  tag: z.string(),
  ok: z.boolean(),
  reason: z.string().optional(),
  judgeFlake: z.boolean().optional(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }),
  durationMs: z.number().int().nonnegative(),
});
export type EvalReportEntry = z.infer<typeof EvalReportEntrySchema>;

/** Full report. */
export const EvalReportSchema = z.object({
  recordedAt: z.string().datetime(),
  totalScenarios: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  totalTokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }),
  perSurface: z.record(
    z.string(),
    z.object({
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      passRate: z.number().min(0).max(1),
    }),
  ),
  perTag: z.record(
    z.string(),
    z.object({
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      passRate: z.number().min(0).max(1),
    }),
  ),
  entries: z.array(EvalReportEntrySchema),
});
export type EvalReport = z.infer<typeof EvalReportSchema>;
