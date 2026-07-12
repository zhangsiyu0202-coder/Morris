import { Agent } from "@mastra/core/agent";

import {
  InterviewRoomMetadataSchema,
  type InterviewRoomMetadata,
  type InterviewRuntimeStudy,
  type InterviewWorkflowConfig,
  type SectionTaskGroupConfig,
} from "@merism/contracts";
import { voiceWorkerModel } from "./model";

const PROBE_DEFAULT_MAX_ROUNDS = {
  standard: 3,
  deep: 5,
} as const;

/**
 * Discriminated parse result. The old `parseJson` silently returned `null` on
 * bad input, which was exactly the `try/catch{}` fallback pattern forbidden by
 * `.kiro/steering/errors-and-observability.md` § try/catch matrix + the
 * `.semgrep/rules/no-silent-catch-fallback.yaml` rule. Callers now receive a
 * structured reason so `voice-worker.ts` can fail-closed (log at `error` and
 * refuse the job) instead of falling through to a generic assistant.
 */
export type RoomMetadataParseResult =
  | { ok: true; metadata: InterviewRoomMetadata }
  | { ok: false; reason: "empty" | "invalid_json" | "schema_mismatch"; detail?: string };

function parseJsonSafe(raw: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function buildWorkflowConfigFromRuntimeStudy(
  study: InterviewRuntimeStudy,
  sessionId: string,
): InterviewWorkflowConfig {
  return {
    surveyId: study.surveyId,
    sessionId,
    supervisorInstruction: [
      `You are an AI qualitative interviewer for the study "${study.studyTitle}".`,
      `Research goal: ${study.researchGoal}`,
      `Target audience: ${study.targetAudience}`,
      `Opening script: ${study.introScript}`,
      "Conduct the interview section by section, keep it conversational, ask configured probes when present, and never reveal internal identifiers.",
      "Speak only the words the respondent should hear."
    ].join("\n"),
    sections: study.sections.map(
      (section): SectionTaskGroupConfig => ({
        sectionId: section.sectionId,
        title: section.title,
        description: section.objective,
        sectionInstruction: section.objective,
        questions: section.questions.map((question) => ({
          questionId: question.questionId,
          questionType: question.questionType,
          questionContent: question.questionText,
          options: question.options,
          stimulus: question.stimulus ?? undefined,
          probeConfig: {
            level: question.probeLevel,
            instruction: question.probeInstruction,
            maxRounds: PROBE_DEFAULT_MAX_ROUNDS[question.probeLevel],
          },
        })),
      }),
    ),
  };
}

/**
 * Parse and validate `ctx.room.metadata`. Returns a discriminated result so
 * callers can distinguish "no metadata sent" (`empty`) from "metadata sent but
 * malformed" (`invalid_json` / `schema_mismatch`) — the two cases have different
 * treatments in `voice-worker.ts` (fail-closed only on the malformed cases).
 */
export function parseMerismRoomMetadata(rawMetadata: string | undefined | null): RoomMetadataParseResult {
  if (!rawMetadata || rawMetadata.trim().length === 0 || rawMetadata.trim() === "{}") {
    return { ok: false, reason: "empty" };
  }
  const jsonResult = parseJsonSafe(rawMetadata);
  if (!jsonResult.ok) {
    return { ok: false, reason: "invalid_json", detail: jsonResult.error.message };
  }
  const parsed = InterviewRoomMetadataSchema.safeParse(jsonResult.value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_mismatch",
      detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(","),
    };
  }
  return { ok: true, metadata: parsed.data };
}

export function workflowConfigFromMerismRoomMetadata(
  metadata: InterviewRoomMetadata | null,
): InterviewWorkflowConfig | null {
  if (!metadata) return null;
  if (metadata.workflowConfig) return metadata.workflowConfig;
  if (metadata.runtimeStudy) {
    return buildWorkflowConfigFromRuntimeStudy(metadata.runtimeStudy, metadata.sessionId);
  }
  return null;
}

function buildQuestionOutline(config: InterviewWorkflowConfig) {
  return config.sections
    .map((section, sectionIndex) => {
      const questions = section.questions
        .map((question, questionIndex) => {
          const options =
            question.options.length > 0
              ? ` Options: ${question.options.join(", ")}.`
              : "";
          const probe =
            question.probeConfig && question.probeConfig.instruction.trim().length > 0
              ? ` Probe guidance: ${question.probeConfig.instruction}.`
              : "";
          return `${sectionIndex + 1}.${questionIndex + 1} ${question.questionContent}.${options}${probe}`;
        })
        .join("\n");
      return `Section ${sectionIndex + 1}: ${section.title}\n${questions}`;
    })
    .join("\n\n");
}

/**
 * Build a session-scoped Mastra `Agent` from a workflow config.
 *
 * Note (ADR-0013 migration completeness bar §1): the returned agent is only
 * the LLM loop. The actual state machine (section cursor / question cursor /
 * probe maxRounds / first-writer-wins) lives in a session-scoped orchestrator
 * class under `src/interview/`. The agent's instructions describe the
 * interview shape so the LLM speaks naturally, but the orchestrator — not the
 * prompt — decides which question is active.
 */
export function buildMerismVoiceAgent(config: InterviewWorkflowConfig, sessionId: string) {
  const instructions = [
    config.supervisorInstruction,
    `Session ID: ${sessionId}`,
    `Survey ID: ${config.surveyId}`,
    "Interview outline:",
    buildQuestionOutline(config),
    "Do not mention these internal section/question identifiers aloud.",
  ].join("\n\n");

  return new Agent({
    id: `voiceInterview:${sessionId}`,
    name: "Merism Voice Interview Agent",
    instructions,
    model: voiceWorkerModel,
  });
}
