/**
 * Legacy-field → markdown migration (ADR-0015).
 *
 * The canonical implementation now lives in `@merism/contracts`
 * (`instruction-helpers.ts`) so the guide-editor "从旧字段合成" button and the
 * analysis consumers (analyzeSession / analyzeSurvey / Notebook) share one
 * composition path — no drift. This module re-exports it to keep the existing
 * `@/lib/instruction/legacy-migration` import path stable for
 * `instruction-view.tsx`.
 */

export {
  composeInstructionFromLegacy,
  type LegacyInstructionSources,
} from "@merism/contracts";
