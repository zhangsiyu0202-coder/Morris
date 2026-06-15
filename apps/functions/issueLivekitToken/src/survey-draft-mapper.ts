// Pure mapping from persisted Appwrite rows -> SurveyDraft (zod-validated). No
// SDK imports. The logic used to live inline in deps.ts::createRoom but a
// silent contract drift (probeLevel emitting "none" while StudyProbeLevelSchema
// only accepts "standard"|"deep") slipped through because the mapper was not
// directly unit-testable. Lifting it here exposes the boundary and keeps the
// SDK wrapper (`deps.ts::createRoom`) thin.
import { SurveyDraftSchema, type SurveyDraft } from "@merism/contracts";

export interface SurveyRow {
  $id: string;
  title: string;
  /** Persisted as JSON string in Appwrite. Parsed by the caller. */
  flowConfig: { researchGoal?: string; targetAudience?: string; introScript?: string } | undefined;
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
  config: { options?: string[] } | undefined;
  probeConfig: { level?: string; instruction?: string } | undefined;
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
  const flow = survey.flowConfig ?? {};

  const draft = {
    title: survey.title,
    researchGoal: flow.researchGoal ?? "",
    targetAudience: flow.targetAudience ?? "",
    introScript: flow.introScript ?? "",
    sections: [...sections]
      .sort((a, b) => a.order - b.order)
      .map((section) => ({
        title: section.title,
        // SurveyDraftSectionSchema.objective requires non-empty. Falling back
        // through description -> sectionInstruction -> "" matches the prior
        // inline mapping; an empty string lets zod surface the violation
        // explicitly rather than fabricating a placeholder.
        objective: section.description || section.sectionInstruction || "",
        questions: questions
          .filter((q) => q.sectionId === section.$id)
          .sort((a, b) => a.orderInSection - b.orderInSection)
          .map((question) => {
            const config = question.config ?? {};
            const probe = question.probeConfig ?? {};
            return {
              questionText: question.prompt,
              questionType: question.type,
              // StudyProbeLevelSchema = z.enum(["standard","deep"]) with default
              // "standard". Only honour an explicit "deep"; missing/legacy
              // values ("none","follow_up", undefined, ...) fall through to the
              // schema default so persisted older surveys keep working.
              probeLevel: probe.level === "deep" ? "deep" : "standard",
              probeInstruction: probe.instruction ?? "",
              options: config.options ?? [],
            };
          }),
      })),
  };

  return SurveyDraftSchema.parse(draft);
}
