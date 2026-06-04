"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  InterviewAgentState,
  InterviewAnswerPayload,
  InterviewRuntimeQuestion,
} from "@merism/contracts"
import { InterviewTransport, type TransportPhase } from "./interview-transport"

export interface LiveInterviewSession {
  /** Connection lifecycle of the underlying LiveKit room. */
  phase: TransportPhase
  /** Latest agent-published interview state, if any has arrived. */
  state: InterviewAgentState | null
  /** The question the agent is currently asking. */
  question: InterviewRuntimeQuestion | undefined
  /** Whether the agent has reported the interview is over. */
  completed: boolean
  /** Last error message surfaced by the transport, if any. */
  error: string | null
  /** Submit a structured answer over RPC. */
  submitAnswer: (answer: InterviewAnswerPayload) => Promise<void>
}

interface ConnectArgs {
  serverUrl: string
  token: string
}

/**
 * Connects the structured renderer to a live LiveKit room.
 *
 * This is the production transport boundary: `state` is hydrated from the
 * agent's `merism.interviewState` attribute and `submitAnswer` invokes the
 * `merism.submit_answer` RPC. The renderer consumes the same `question` shape
 * it does in preview mode, so no UI changes are needed to go live.
 */
export function useLiveInterview(args: ConnectArgs | null): LiveInterviewSession {
  const [phase, setPhase] = useState<TransportPhase>("idle")
  const [state, setState] = useState<InterviewAgentState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const transportRef = useRef<InterviewTransport | null>(null)

  useEffect(() => {
    if (!args) return

    const transport = new InterviewTransport({
      onPhase: setPhase,
      onState: setState,
      onError: setError,
    })
    transportRef.current = transport

    let cancelled = false
    transport.connect(args.serverUrl, args.token).catch(() => {
      // Phase/error already surfaced via callbacks.
    })

    return () => {
      cancelled = true
      transportRef.current = null
      void transport.disconnect()
      if (cancelled) setPhase("disconnected")
    }
  }, [args])

  const submitAnswer = useCallback(async (answer: InterviewAnswerPayload) => {
    const transport = transportRef.current
    if (!transport) return
    await transport.submitAnswer(answer)
  }, [])

  const question = state?.currentQuestion
  const completed = state?.status === "completed"

  return useMemo(
    () => ({ phase, state, question, completed, error, submitAnswer }),
    [phase, state, question, completed, error, submitAnswer],
  )
}
