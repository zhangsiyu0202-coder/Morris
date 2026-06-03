import { SurveyDraftSchema, SurveyDraftSectionSchema, StudyQuestionTypeSchema } from "@merism/contracts"
import { defineTool } from "@copilotkit/runtime/v2"
import { z } from "zod"
import { buildMorisPrompt } from "./prompts"

type StudyQuestionType = z.infer<typeof StudyQuestionTypeSchema>

function countQuestions(draft: z.infer<typeof SurveyDraftSchema>): number {
  return draft.sections.reduce(
    (count: number, section) => count + section.questions.length,
    0,
  )
}

const QUESTION_TYPE_GUIDE: Array<{
  type: StudyQuestionType
  whenToUse: string
  notes: string
}> = [
  {
    type: "open_ended",
    whenToUse: "Primary qualitative question for stories, motivations, and lived experience.",
    notes: "Default choice for voice interviews.",
  },
  {
    type: "single_choice",
    whenToUse: "Constrained decisions where one answer is enough.",
    notes: "Requires at least two options.",
  },
  {
    type: "multi_choice",
    whenToUse: "Checklist-style recall or feature usage inventory.",
    notes: "Requires at least two options.",
  },
  {
    type: "rating",
    whenToUse: "Light quantification before a follow-up why-question.",
    notes: "Keep scales simple and ask why after the score.",
  },
  {
    type: "nps",
    whenToUse: "Standard recommendation likelihood prompt.",
    notes: "Follow immediately with an open-ended why question.",
  },
  {
    type: "ranking",
    whenToUse: "Prioritization among a short option set.",
    notes: "Requires at least two options and works best with 3-5 choices.",
  },
]

export const COPILOT_AGENT_PROMPT = buildMorisPrompt()

export const COPILOT_SERVER_TOOLS = [
  defineTool({
    name: "getSurveyAuthoringGuide",
    description:
      "Returns the allowed interview survey question types and authoring guidance for the survey design workspace.",
    parameters: z.object({}),
    execute: async () => ({
      platform: "MerismV2",
      interviewMode: "qualitative voice interview",
      questionTypes: QUESTION_TYPE_GUIDE,
      draftShape: {
        title: "string",
        researchGoal: "string",
        targetAudience: "string",
        introScript: "string",
        sections: [
          {
            title: "string",
            objective: "string",
            questions: [
              {
                questionText: "string",
                questionType: "StudyQuestionType",
                probeLevel: "none|follow_up|deep",
                probeInstruction: "string",
                options: ["string"],
              },
            ],
          },
        ],
      },
    }),
  }),
  defineTool({
    name: "validateSurveyDraft",
    description:
      "Validate a proposed survey draft against the shared MerismV2 contract before applying it.",
    parameters: SurveyDraftSchema,
    execute: async (draft) => {
      const parsed = SurveyDraftSchema.safeParse(draft)
      if (parsed.success) {
        return {
          ok: true,
          sectionCount: parsed.data.sections.length,
          questionCount: parsed.data.sections.reduce(
            (count, section) => count + section.questions.length,
            0,
          ),
        }
      }

      return {
        ok: false,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }
    },
  }),
  defineTool({
    name: "replaceSurveyDraft",
    description:
      "Replace the entire interview survey draft in the survey design workspace. IMPORTANT: this requires researcher confirmation via an approval dialog — the researcher will review and approve the replacement before it takes effect.",
    parameters: SurveyDraftSchema,
    execute: async (draft) => {
      const parsed = SurveyDraftSchema.parse(draft)
      return `Proposed draft "${parsed.title}" with ${parsed.sections.length} sections and ${countQuestions(parsed)} questions. Awaiting researcher approval.`
    },
  }),
]
