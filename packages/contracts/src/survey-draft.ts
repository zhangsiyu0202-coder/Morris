import type { SurveyDraft } from "./api.js";
import { SurveyDraftSchema } from "./api.js";

export interface SurveyDraftSource {
  survey: {
    title: string;
    flowConfig?: Record<string, unknown> | null;
    moderatorInstruction?: string | null;
  };
  sections: ReadonlyArray<{
    $id: string;
    title: string;
    description?: string | null;
    sectionInstruction?: string | null;
    order: number;
  }>;
  questions: ReadonlyArray<{
    $id: string;
    sectionId: string;
    prompt: string;
    type: string;
    orderInSection: number;
    config?: Record<string, unknown> | null;
    probeConfig?: { level?: string; instruction?: string } | null;
    stimulus?: { id: string; type: string; url?: string; text?: string; durationMs?: number } | null;
  }>;
}

function toDraftQuestionType(type: string): "open_ended" | "single_choice" | "multi_choice" | "rating" | "nps" | "ranking" {
  switch (type) {
    case "open_ended":
    case "single_choice":
    case "multi_choice":
    case "rating":
    case "nps":
    case "ranking":
      return type;
    default:
      return "open_ended";
  }
}

function flowString(flowConfig: Record<string, unknown>, key: string): string {
  const value = flowConfig[key];
  return typeof value === "string" ? value : "";
}

function configOptions(config: Record<string, unknown>): string[] {
  const value = config.options;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function buildSurveyDraft(source: SurveyDraftSource): SurveyDraft {
  const { survey, sections, questions } = source;
  const flow = (survey.flowConfig ?? {}) as Record<string, unknown>;

  const draft = {
    title: survey.title,
    researchGoal: flowString(flow, "researchGoal"),
    targetAudience: flowString(flow, "targetAudience"),
    introScript: flowString(flow, "introScript"),
    moderatorInstruction: survey.moderatorInstruction ?? "",
    sections: [...sections]
      .sort((a, b) => a.order - b.order)
      .map((section) => ({
        title: section.title,
        objective: section.description || section.sectionInstruction || "",
        questions: questions
          .filter((question) => question.sectionId === section.$id)
          .sort((a, b) => a.orderInSection - b.orderInSection)
          .map((question) => {
            const config = (question.config ?? {}) as Record<string, unknown>;
            return {
              questionText: question.prompt,
              questionType: toDraftQuestionType(question.type),
              probeLevel: question.probeConfig?.level === "deep" ? "deep" : "standard",
              probeInstruction: question.probeConfig?.instruction ?? "",
              options: configOptions(config),
              stimulus: question.stimulus ?? undefined,
            };
          }),
      })),
  };

  return SurveyDraftSchema.parse(draft);
}
