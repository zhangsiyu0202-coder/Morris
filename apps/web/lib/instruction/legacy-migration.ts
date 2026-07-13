/**
 * Legacy-field → markdown migration (ADR-0015 Wave 2).
 *
 * A pure, LLM-free composer that turns the four legacy Survey fields
 * (`moderatorInstruction`, `flowConfig.researchGoal`,
 * `flowConfig.targetAudience`, `flowConfig.introScript`) into a
 * best-effort markdown skeleton matching the ADR-0015 section template.
 * Used by the "从旧字段合成" button in the guide editor's 研究说明 tab
 * to migrate pre-ADR-0015 surveys without spending an LLM call.
 *
 * The output is intentionally minimal — enough to preserve the researcher's
 * existing wording and structure, but not to synthesize new content. If the
 * researcher wants richer output they use "生成 baseline" (LLM path) or
 * hand-edit.
 *
 * This function returns `null` when all four legacy fields are empty
 * (nothing to migrate) so the UI can gate the button visibility.
 */

export interface LegacyInstructionSources {
  researchGoal?: string;
  targetAudience?: string;
  introScript?: string;
  moderatorInstruction?: string;
}

const HEADINGS = {
  intent: "## 研究意图",
  audience: "## 访谈对象",
  behavior: "## 主持行为要点",
  intro: "## 开场",
  end: "## 结束",
} as const;

function block(heading: string, body: string): string {
  return `${heading}\n${body.trim()}\n`;
}

/**
 * Compose a markdown instruction from the four legacy fields. Sections
 * with no source content are omitted so the researcher does not see empty
 * headings.
 *
 * Returns `null` when every legacy field is empty — the caller should hide
 * the "从旧字段合成" button in that case (nothing to compose).
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
  // 结束 section — legacy shape has no source for this, so omit rather
  // than fabricate. Researcher can add manually if needed.

  return parts.join("\n").trim();
}
