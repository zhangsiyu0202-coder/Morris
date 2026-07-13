/**
 * `generateInstructionBaselineAction` — server action for the guide editor's
 * "生成 baseline" button (ADR-0015 Wave 2). Reads the current survey +
 * questions + optional legacy fields, calls the shared generator, and
 * returns the markdown for the researcher to review + save.
 *
 * The action does NOT persist. The UI decides when to write to Appwrite
 * (via existing saveSurveyDraft path) so the researcher can preview / edit
 * the baseline before it lands. This matches Claude Code's `/init`: it
 * proposes CLAUDE.md content; the developer accepts by saving.
 */

"use server";

import { createLogger } from "@merism/observability";

import { requireOwnerUserId } from "@/lib/auth/owner";
import { loadSurveyDraft } from "@/lib/survey/read";
import { generateInstructionBaseline } from "@/lib/instruction/generator";
import { getServerClient, DATABASE_ID } from "@/lib/queries/client";

const SURVEYS = "surveys";

export type InstructionBaselineResult =
  | { ok: true; markdown: string }
  | { ok: false; error: InstructionBaselineError };

export type InstructionBaselineError =
  | "not_authenticated"
  | "survey_not_found"
  | "no_questions"
  | "generation_failed";

/**
 * Generate a markdown instruction baseline for a study.
 *
 * Preconditions:
 *   - Caller is authenticated (owner-scope inherited from loadSurveyDraft).
 *   - Survey has at least one question (else the LLM has no context to
 *     work from and would produce a generic template).
 *
 * On failure returns a discriminated error variant so the client can
 * render a specific message. Never throws past the boundary — the
 * generator's LLM failure is caught and mapped to `generation_failed`.
 */
export async function generateInstructionBaselineAction(
  surveyId: string,
): Promise<InstructionBaselineResult> {
  const log = createLogger("action.instruction.baseline");
  // Owner-scope check. `loadSurveyDraft` returns null for non-owners; we
  // treat both cases (not signed in, and signed in but not the owner) as
  // "not authenticated" from the client's perspective — the client should
  // send them to sign in.
  try {
    await requireOwnerUserId();
  } catch {
    return { ok: false, error: "not_authenticated" };
  }

  const loaded = await loadSurveyDraft(surveyId);
  if (!loaded) {
    return { ok: false, error: "survey_not_found" };
  }

  // Flatten questions across sections — sections are editor UX grouping,
  // not a runtime concept the generator cares about.
  const questions = loaded.draft.sections.flatMap((section) =>
    section.questions.map((q) => ({
      text: q.questionText,
      type: q.questionType,
    })),
  );
  if (questions.length === 0) {
    return { ok: false, error: "no_questions" };
  }

  try {
    const markdown = await generateInstructionBaseline({
      traceId: log.traceId,
      surveyTitle: loaded.draft.title,
      questions,
    });
    log.info("instruction.baseline.generated", {
      surveyId,
      chars: markdown.length,
    });
    return { ok: true, markdown };
  } catch (err) {
    log.warn("instruction.baseline.generation_failed", {
      surveyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "generation_failed" };
  }
}

// ---------------------------------------------------------------------------
// Save action — targeted write of just the instruction column
// ---------------------------------------------------------------------------

export type SaveInstructionResult =
  | { ok: true; version: number }
  | { ok: false; error: "not_authenticated" | "survey_not_owned" | "internal_error" };

/**
 * Persist `markdown` to `Survey.instruction`. Owner-scope check + version
 * bump follow the same pattern as `saveSurveyDraft`. Kept as a separate
 * action from `saveSurveyDraft` so the 研究说明 tab can save without
 * touching sections / questions (which have their own edit surface in the
 * 提纲 tab).
 */
export async function saveInstructionAction(
  surveyId: string,
  markdown: string,
): Promise<SaveInstructionResult> {
  const log = createLogger("action.instruction.save");
  let owner: string;
  try {
    owner = await requireOwnerUserId();
  } catch {
    return { ok: false, error: "not_authenticated" };
  }

  const database = getServerClient().databases;
  let doc: { authorId?: string; ownerUserId?: string; version?: number };
  try {
    doc = (await database.getDocument(DATABASE_ID, SURVEYS, surveyId)) as typeof doc;
  } catch (err) {
    log.warn("instruction.save.survey_load_failed", {
      surveyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "internal_error" };
  }
  // ADR-0006 D3: edit is author-private within a workspace.
  const isAuthor = doc.authorId === owner || doc.ownerUserId === owner;
  if (!isAuthor) {
    return { ok: false, error: "survey_not_owned" };
  }

  const nextVersion = Number(doc.version ?? 1) + 1;
  try {
    await database.updateDocument(DATABASE_ID, SURVEYS, surveyId, {
      instruction: markdown,
      version: nextVersion,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.warn("instruction.save.update_failed", {
      surveyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "internal_error" };
  }

  log.info("instruction.saved", { surveyId, chars: markdown.length, version: nextVersion });
  return { ok: true, version: nextVersion };
}
