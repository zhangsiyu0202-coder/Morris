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
  /**
   * Researcher-authored AI moderator persona / tone / pacing directives.
   * Stored on Appwrite as a dedicated top-level column (NOT inside the
   * flowConfig JSON bucket — see packages/appwrite-schema/src/schema.ts).
   * Historically the mapper's SurveyRow shape did not declare this field
   * and the SDK wrapper did not pass it through, so every published survey
   * silently lost the researcher's persona on its way to the LiveKit
   * worker. Companion fix to the branchRules read-path repair in commit
   * 34ff5aa. Guarded by the moderatorInstruction round-trip test in
   * survey-draft-mapper.test.ts.
   *
   * Legacy field, being sunset per ADR-0015 (instruction-as-context-doc);
   * once `instruction` is populated, this field is ignored downstream.
   */
  moderatorInstruction?: string;
  /**
   * `instruction` — the CLAUDE.md-style single free-form markdown document
   * that carries the full AI moderator operating manual. Per ADR-0015
   * supersedes the four legacy fields (moderatorInstruction /
   * researchGoal / targetAudience / introScript). The mapper prefers this
   * value when non-empty; when empty (legacy row that predates the
   * column), the mapper leaves `draft.instruction` empty and the
   * composer's fallback reconstructs a supervisor instruction from the
   * legacy fields via `buildInterviewWorkflowConfigFromDraft`.
   */
  instruction?: string;
}

export interface SectionRow {
  $id: string;
  title: string;
  description?: string;
  sectionInstruction?: string;
  order: number;
}

/**
 * Persisted question row. Note the JSON buckets are pre-parsed by the caller
 * so this mapper stays pure (no `JSON.parse` here, so bad-JSON handling
 * belongs in the SDK wrapper).
 *
 * JSON-bucket piggyback map (see `apps/web/lib/actions/survey.ts` writer):
 *   - `config.stableId`   — editor-generated stable id for branch rule targets
 *   - `config.allowSkip`  — researcher's per-question skip toggle
 *   - `config.options`    — choice-based options (order preserved)
 *   - `probeConfig.level` / `.instruction` — probe policy
 *   - `stimulus`          — top-level stimulus JSON (image/video/url)
 *   - `skipLogic.branchRules` — researcher-authored branch rules
 *
 * Historically the mapper only read `config.options` + `probeConfig`, silently
 * dropping `stableId` / `allowSkip` / `stimulus` / `branchRules`. That drift
 * made the entire branch-rules feature user-invisible: researchers could
 * configure rules in the guide editor, they persisted, but they never
 * reached the flow-engine composer. Fixed here + guarded by the new tests
 * in `survey-draft-mapper.test.ts`.
 */
export interface QuestionRow {
  $id: string;
  sectionId: string;
  prompt: string;
  type: string;
  orderInSection: number;
  /** Persisted JSON. Parsed by the caller before this hits the mapper. */
  config: { options?: string[]; stableId?: string; allowSkip?: boolean } | undefined;
  probeConfig: { level?: string; instruction?: string } | undefined;
  /** Persisted JSON (or undefined for legacy rows). Parsed by the caller. */
  stimulus?: unknown;
  /**
   * Persisted JSON on the `skipLogic` Appwrite bucket. `branchRules` is the
   * only shape shipped so far — other keys are reserved for future
   * typebot-style skip logic. Parsed by the caller.
   */
  skipLogic: { branchRules?: unknown } | undefined;
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
    // Survey-level AI moderator persona. Empty string is the schema
    // default and is legal (SurveyDraftSchema.moderatorInstruction defaults
    // to ""); the composer treats an empty value as "use the operational
    // base only". Dropping this field entirely (as the mapper used to)
    // silently discarded the researcher's persona for every session.
    moderatorInstruction: survey.moderatorInstruction ?? "",
    // ADR-0015 primary field. Passes through directly; legacy composer
    // fallback (in `buildInterviewFlowConfigFromDraft`) handles the case
    // where this field is empty on a pre-migration row.
    instruction: survey.instruction ?? "",
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
            const skipLogic = question.skipLogic ?? {};
            // branchRules are parsed by the caller from a JSON bucket, so
            // they arrive as `unknown`. Passing them through undefaulted
            // lets SurveyDraftQuestionSchema.parse validate the whole
            // shape (including the top-level superRefine that checks
            // stableId cross-references) in one place. If a bad payload
            // slipped past the writer, the parse throws with a stable
            // issue path; the caller maps it to a 500.
            const branchRules = Array.isArray(skipLogic.branchRules)
              ? skipLogic.branchRules
              : [];
            const row: Record<string, unknown> = {
              questionText: question.prompt,
              questionType: question.type,
              // StudyProbeLevelSchema = z.enum(["standard","deep"]) with default
              // "standard". Only honour an explicit "deep"; missing/legacy
              // values ("none","follow_up", undefined, ...) fall through to the
              // schema default so persisted older surveys keep working.
              probeLevel: probe.level === "deep" ? "deep" : "standard",
              probeInstruction: probe.instruction ?? "",
              options: config.options ?? [],
              allowSkip: config.allowSkip ?? false,
              branchRules,
            };
            // Only include optional keys when we actually have a value —
            // the schema treats absent-vs-empty differently for
            // `stableId` (min(1) if present) and `stimulus` (validated
            // when present).
            if (config.stableId) row.stableId = config.stableId;
            if (question.stimulus !== undefined && question.stimulus !== null) {
              row.stimulus = question.stimulus;
            }
            return row;
          }),
      })),
  };

  return SurveyDraftSchema.parse(draft);
}
