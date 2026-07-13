/**
 * Instruction resolution helpers (ADR-0015 instruction-as-context-document).
 *
 * These are the canonical, cross-module pure helpers for turning a study's
 * instruction surface into the single research-intent string that every LLM
 * consumer reads. They live in `packages/contracts` (not `apps/web`) because
 * both the web guide-editor migration button AND the analysis Functions
 * (analyzeSession / analyzeSurvey) plus Notebook generation depend on the
 * exact same "prefer instruction, else compose from the four legacy fields"
 * logic. Defining it once here prevents the composition drift that ADR-0015
 * exists to eliminate.
 *
 * No I/O, no zod runtime — pure string logic per `contracts.md` (helpers that
 * cannot be expressed as a schema live here as pure functions).
 */

/**
 * The four soon-to-be-sunset legacy fields that carried research intent
 * before ADR-0015 introduced the single `Survey.instruction` document.
 */
export interface LegacyInstructionSources {
  researchGoal?: string;
  targetAudience?: string;
  introScript?: string;
  moderatorInstruction?: string;
}

/**
 * All inputs `resolveResearchIntent` needs: the ADR-0015 `instruction`
 * document plus the legacy fields it supersedes.
 */
export interface ResearchIntentSources extends LegacyInstructionSources {
  /** The CLAUDE.md-style single free-form markdown operating manual. */
  instruction?: string;
}

const HEADINGS = {
  intent: "## 研究意图",
  audience: "## 访谈对象",
  behavior: "## 主持行为要点",
  intro: "## 开场",
} as const;

function block(heading: string, body: string): string {
  return `${heading}\n${body.trim()}\n`;
}

/**
 * Compose a markdown instruction skeleton from the four legacy fields, in the
 * ADR-0015 section order (研究意图 → 访谈对象 → 主持行为要点 → 开场). Sections
 * with no source content are omitted so consumers never see empty headings.
 * The 结束 section is intentionally never fabricated — the legacy shape has no
 * source for it.
 *
 * Returns `null` when every legacy field is empty (nothing to compose). The
 * guide-editor "从旧字段合成" button uses the `null` return to gate its
 * visibility; `resolveResearchIntent` coerces `null` to `""`.
 */
export function composeInstructionFromLegacy(
  sources: LegacyInstructionSources,
): string | null {
  const goal = sources.researchGoal?.trim() ?? "";
  const audience = sources.targetAudience?.trim() ?? "";
  const intro = sources.introScript?.trim() ?? "";
  const moderator = sources.moderatorInstruction?.trim() ?? "";

  if (!goal && !audience && !intro && !moderator) {
    return null;
  }

  const parts: string[] = [];
  if (goal) parts.push(block(HEADINGS.intent, goal));
  if (audience) parts.push(block(HEADINGS.audience, audience));
  if (moderator) parts.push(block(HEADINGS.behavior, moderator));
  if (intro) parts.push(block(HEADINGS.intro, intro));

  return parts.join("\n").trim();
}

/**
 * Resolve the single research-intent string every downstream LLM consumer
 * reads (analyzeSession, analyzeSurvey, Notebook generation). Preference order
 * per ADR-0015:
 *
 *   1. `instruction` (trimmed) when non-empty — the CLAUDE.md-style operating
 *      manual is used verbatim, no post-processing.
 *   2. Otherwise fall back to composing the four legacy fields (for pre-Wave-2
 *      surveys that only carry `researchGoal` / `targetAudience` / etc.).
 *
 * Returns `""` when neither source has content, so callers can cheaply decide
 * to omit the research-intent backdrop entirely rather than emit an empty
 * section.
 */
export function resolveResearchIntent(sources: ResearchIntentSources): string {
  const instruction = sources.instruction?.trim() ?? "";
  if (instruction.length > 0) return instruction;
  return composeInstructionFromLegacy(sources) ?? "";
}
