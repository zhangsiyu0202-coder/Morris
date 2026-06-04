"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  InterviewAgentState,
  InterviewAnswerPayload,
  InterviewRuntimeQuestion,
} from "@merism/contracts";
import { MOCK_RUNTIME_QUESTIONS } from "./mock-session";

export interface InterviewSession {
  /** Agent-published runtime state (mocked here). */
  state: InterviewAgentState;
  /** The question the agent is currently asking, if any. */
  question: InterviewRuntimeQuestion | undefined;
  /** Zero-based progress across the whole study. */
  index: number;
  total: number;
  isLast: boolean;
  /** Submit the respondent's structured answer and advance. */
  submitAnswer: (answer: InterviewAnswerPayload) => void;
  /** Preview-only: jump to a specific question (not used in production). */
  jumpTo: (target: number) => void;
}

/**
 * Drives the structured renderer from a local fixture.
 *
 * The transport boundary lives here: in production `state` would be hydrated
 * from the `merism.interviewState` participant attribute and `submitAnswer`
 * would invoke the `merism.submit_answer` RPC. The renderer below never needs
 * to know which of the two is wired in.
 */
export function useInterviewSession(): InterviewSession {
  const [index, setIndex] = useState(0);
  const questions = MOCK_RUNTIME_QUESTIONS;

  const question = questions[index];
  const isLast = index >= questions.length - 1;

  const state = useMemo<InterviewAgentState>(
    () => ({
      status: question ? "collecting" : "completed",
      currentSectionId: question?.sectionId,
      currentQuestionId: question?.questionId,
      currentQuestion: question,
      updatedAt: new Date().toISOString(),
    }),
    [question],
  );

  const submitAnswer = useCallback(
    (answer: InterviewAnswerPayload) => {
      // TODO(interview-portal): replace with `merism.submit_answer` RPC.
      console.log("[v0] submitAnswer", answer);
      setIndex((current) => Math.min(current + 1, questions.length));
    },
    [questions.length],
  );

  const jumpTo = useCallback(
    (target: number) => {
      setIndex(Math.max(0, Math.min(target, questions.length)));
    },
    [questions.length],
  );

  return {
    state,
    question,
    index,
    total: questions.length,
    isLast,
    submitAnswer,
    jumpTo,
  };
}
