/**
 * Schema registry — maps human-readable schema names to zod schemas.
 *
 * Corpus rows reference schemas by name (string) so the `.jsonl` stays
 * code-free. The registry turns those names into actual `ZodSchema`
 * instances at scoring time. Add a row here when a new surface needs
 * a new contract schema in its rubric.
 */
import { SurveyDraftSchema } from "@merism/contracts";
import type { ZodSchema } from "zod";

export const SCHEMA_REGISTRY: Readonly<Record<string, ZodSchema>> = Object.freeze({
  SurveyDraftSchema,
  // Add new entries here as surfaces expand:
  //   MemoryActionResultSchema, AnalysisReportSchema, etc.
});

/** Resolve a schema by name, or null if unknown. */
export function resolveSchema(name: string): ZodSchema | null {
  return SCHEMA_REGISTRY[name] ?? null;
}
