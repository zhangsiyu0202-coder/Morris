// Pure mapping from persisted Appwrite rows -> SurveyDraft (zod-validated). No
// SDK imports. The logic used to live inline in deps.ts::createRoom but a
// silent contract drift (probeLevel emitting "none" while StudyProbeLevelSchema
// only accepts "standard"|"deep") slipped through because the mapper was not
// directly unit-testable. Lifting it here exposes the seam and keeps the SDK
// wrapper (`deps.ts::createRoom`) thin.
import { buildSurveyDraft, type SurveyDraft } from "@merism/contracts";

export interface SurveyRow {
  $id: string;
  title: string;
  /** Persisted as JSON string in Appwrite. Parsed by the caller. */
  flowConfig: { researchGoal?: string; targetAudience?: string; introScript?: string } | undefined;
  /**
   * Researcher-authored moderator persona / tone / pacing / style. Stored as a
   * top-level TEXT column on `surveys` (T17 of `survey-editor/tasks.md`), not
   * inside flowConfig. Passed through verbatim so the contract-level composer
   * (`buildInterviewWorkflowConfigFromDraft`) can prepend it to the operational
   * supervisor instruction; missing/undefined falls through to default "" which
   * the composer treats as "use the operational base only".
   */
  moderatorInstruction?: string | null;
}

export interface SectionRow {
  $id: string;
  title: string;
  description?: string;
  sectionInstruction?: string;
  order: number;
}

export interface QuestionRow {
  $id: string;
  sectionId: string;
  prompt: string;
  type: string;
  orderInSection: number;
  /** Persisted JSON. Parsed by the caller before this hits the mapper. */
  config: Record<string, unknown> | undefined;
  probeConfig: { level?: string; instruction?: string } | undefined;
  stimulus?: { id: string; type: string; url?: string; text?: string; durationMs?: number } | null;
}

export interface BuildSurveyDraftInput {
  survey: SurveyRow;
  sections: ReadonlyArray<SectionRow>;
  questions: ReadonlyArray<QuestionRow>;
}

/**
 * Map persisted Appwrite rows into a `SurveyDraft` and validate with the
 * canonical zod schema. Throws ZodError on shape mismatch — callers (the SDK
 * wrapper) decide whether that becomes a 4xx (researcher's fault) or a 500
 * (operator's fault). Today `issueLivekitToken` lets this surface as 500
 * because by the time a token is being issued the draft is already published
 * and any shape mismatch is a server-side data integrity issue.
 */
export function buildSurveyDraftFromDocs(input: BuildSurveyDraftInput): SurveyDraft {
  const { survey, sections, questions } = input;
  return buildSurveyDraft({
    survey,
    sections,
    questions,
  });
}
