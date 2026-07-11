/**
 * Schema registry — maps human-readable schema names to zod schemas.
 *
 * Corpus rows reference schemas by name (string) so the `.jsonl` stays
 * code-free. The registry turns those names into actual `ZodSchema`
 * instances at scoring time. Add a row here when a new surface needs
 * a new contract schema in its rubric.
 */
import {
  AnalysisReportOutputSchema,
  ManageMemoriesActionSchema,
  SurveyDraftSchema,
} from "@merism/contracts";
import type { ZodSchema } from "zod";

import { ExtractedThemesListSchema } from "../../../apps/functions/analyzeSurvey/src/rollup";

export const SCHEMA_REGISTRY: Readonly<Record<string, ZodSchema>> = Object.freeze({
  SurveyDraftSchema,
  ManageMemoriesActionSchema,
  AnalysisReportOutputSchema,
  ExtractedThemesListSchema,
});

/** Resolve a schema by name, or null if unknown. */
export function resolveSchema(name: string): ZodSchema | null {
  return SCHEMA_REGISTRY[name] ?? null;
}
