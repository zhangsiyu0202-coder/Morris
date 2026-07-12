import type {
  InterviewAnswerPayload,
  InterviewWorkflowConfig,
  InterviewWorkflowState,
  QuestionTaskConfig,
  QuestionTaskResult,
  SectionTaskGroupConfig,
  SectionTaskGroupResult,
} from "@merism/contracts";

/**
 * Pure interview workflow helpers (no LiveKit / Appwrite imports).
 *
 * Ported verbatim from `apps/agent/agent/interview/workflow.py` per ADR-0013.
 * These functions own the correctness of the Supervisor workflow —
 * advancing state as question tasks complete and projecting collected
 * results into the shape persisted on the session. The workflow shape from
 * ADR-0001 (Supervisor → Section → Question) is preserved; only the host
 * runtime moves from Python `livekit-agents` to TS `@mastra/livekit`.
 *
 * Keeping them side-effect free makes the workflow unit / property testable
 * without the realtime stack. The orchestrator (orchestrator.ts) drives
 * LiveKit and delegates all state transitions here.
 */

/**
 * Whether a UI-submitted answer may complete the current question (pure).
 *
 * A click only counts for the question the agent is currently on: there
 * must be an active question task and the submitted questionId must match
 * the live cursor. Mismatches are stale / duplicate / out-of-order submits.
 * Mirrors the bridge-path guard so both answer paths honor the same
 * authoritative cursor.
 */
export function shouldAcceptUiAnswer(args: {
  submittedQuestionId: string;
  currentQuestionId: string | null | undefined;
  hasActiveTask: boolean;
}): boolean {
  return (
    args.hasActiveTask &&
    args.currentQuestionId != null &&
    args.submittedQuestionId === args.currentQuestionId
  );
}

/**
 * Render a UI-submitted structured answer as the human-readable string
 * stored in `QuestionTaskResult.respondentAnswer` (pure).
 *
 * Precedence matches the response modes: free text, then selected options
 * (single/multi), then a ranking order, then a numeric score (scale/nps).
 */
export function formatUiAnswer(answer: InterviewAnswerPayload): string {
  if (answer.text.trim().length > 0) return answer.text.trim();
  if (answer.selectedOptions.length > 0) return answer.selectedOptions.join(", ");
  if (answer.ranking.length > 0) return answer.ranking.join(" > ");
  if (answer.score != null) {
    return Number.isInteger(answer.score) ? String(Math.trunc(answer.score)) : String(answer.score);
  }
  return "";
}

/** Total number of configured questions across all sections. */
export function totalQuestionCount(config: InterviewWorkflowConfig): number {
  return config.sections.reduce((acc, section) => acc + section.questions.length, 0);
}

/** Count questions with a recorded result. */
export function completedQuestionCount(state: InterviewWorkflowState): number {
  return Object.values(state.sectionResults).reduce(
    (acc, section) => acc + Object.keys(section.questionResults).length,
    0,
  );
}

/** True when every configured question has a recorded result. */
export function isComplete(state: InterviewWorkflowState): boolean {
  return completedQuestionCount(state) >= totalQuestionCount(state.workflowConfig);
}

/** Build the starting workflow state positioned at the first question. */
export function initialWorkflowState(config: InterviewWorkflowConfig): InterviewWorkflowState {
  const firstSection = config.sections[0];
  const firstQuestion = firstSection?.questions[0];
  return {
    sessionId: config.sessionId,
    surveyId: config.surveyId,
    workflowConfig: config,
    currentSectionId: firstSection?.sectionId,
    currentQuestionTaskId: firstQuestion?.questionId,
    sectionResults: {},
    transcriptBuffer: [],
  };
}

/** Store one question result into the section results map (mutates in place). */
export function recordQuestionResult(
  state: InterviewWorkflowState,
  args: { sectionId: string; questionId: string; result: QuestionTaskResult },
): InterviewWorkflowState {
  let sectionResult: SectionTaskGroupResult | undefined = state.sectionResults[args.sectionId];
  if (!sectionResult) {
    sectionResult = { sectionId: args.sectionId, questionResults: {} };
    state.sectionResults[args.sectionId] = sectionResult;
  }
  sectionResult.questionResults[args.questionId] = args.result;
  return state;
}

/** Move the cursor to a specific section/question (mutates in place). */
export function advanceTo(
  state: InterviewWorkflowState,
  args: { sectionId: string | undefined; questionId: string | undefined },
): InterviewWorkflowState {
  state.currentSectionId = args.sectionId;
  state.currentQuestionTaskId = args.questionId;
  return state;
}

/**
 * Find the next (sectionId, questionId) after the current cursor, walking
 * sections in order, questions in order. Returns `null` when the last
 * question is complete.
 */
export function findNextCursor(
  state: InterviewWorkflowState,
): { sectionId: string; questionId: string } | null {
  const { sections } = state.workflowConfig;
  const currentSectionIdx = sections.findIndex((s) => s.sectionId === state.currentSectionId);
  if (currentSectionIdx < 0) {
    // Cursor is unset — start at the beginning.
    const first = sections[0];
    if (!first) return null;
    const q = first.questions[0];
    return q ? { sectionId: first.sectionId, questionId: q.questionId } : null;
  }
  const currentSection = sections[currentSectionIdx];
  const currentQuestionIdx = currentSection.questions.findIndex(
    (q) => q.questionId === state.currentQuestionTaskId,
  );
  const nextInSection = currentSection.questions[currentQuestionIdx + 1];
  if (nextInSection) {
    return { sectionId: currentSection.sectionId, questionId: nextInSection.questionId };
  }
  const nextSection = sections[currentSectionIdx + 1];
  if (nextSection && nextSection.questions[0]) {
    return { sectionId: nextSection.sectionId, questionId: nextSection.questions[0].questionId };
  }
  return null;
}

/**
 * Project recorded results into the `InterviewSession.collectedAnswers` JSON.
 *
 * Keyed by questionId so it can be merged with UI-submitted answers and read
 * back by the analysis module. Matches the Python `collected_answers_map`
 * output byte-for-byte for the shared analysis Function.
 */
export function collectedAnswersMap(
  state: InterviewWorkflowState,
): Record<string, Record<string, unknown>> {
  const answers: Record<string, Record<string, unknown>> = {};
  for (const sectionResult of Object.values(state.sectionResults)) {
    for (const [questionId, result] of Object.entries(sectionResult.questionResults)) {
      const entry: Record<string, unknown> = {
        sectionId: sectionResult.sectionId,
        questionType: result.questionType,
        questionContent: result.questionContent,
        answer: result.respondentAnswer,
        source: "voice",
      };
      if (result.probe) {
        entry.probe = {
          level: result.probe.level,
          probeInstruction: result.probe.probeInstruction,
          rounds: result.probe.rounds.map((round) => ({
            probeQuestion: round.probeQuestion,
            answer: round.respondentAnswer,
          })),
        };
      }
      answers[questionId] = entry;
    }
  }
  return answers;
}

/** Flatten `sections[].questions[]` into an ordered `{sectionId, question}[]`. */
export function flattenQuestions(
  config: InterviewWorkflowConfig,
): Array<{ section: SectionTaskGroupConfig; question: QuestionTaskConfig }> {
  return config.sections.flatMap((section) =>
    section.questions.map((question) => ({ section, question })),
  );
}
