"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { LocalVideoTrack } from "livekit-client"
import type {
  InterviewAgentState,
  InterviewAnswerPayload,
  InterviewRoomMetadata,
  InterviewRuntimeQuestion,
  InterviewRuntimeStudy,
} from "@merism/contracts"
import {
  InterviewTransport,
  type LocalMediaState,
  type TranscriptSegmentUpdate,
  type TranscriptSpeaker,
  type TransportPhase,
} from "./interview-transport"

/** A coalesced transcript line surfaced to the conversation panel. */
export interface TranscriptLine {
  id: string
  text: string
  final: boolean
  speaker: TranscriptSpeaker
}

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
  /** Ordered transcript lines (interim + final) from the live conversation. */
  transcript: TranscriptLine[]
  /** Local mic/camera/screenshare publish snapshot. */
  media: LocalMediaState
  /** Local camera track for self-view rendering, or null when the camera is off. */
  localVideoTrack: LocalVideoTrack | null
  /**
   * Interview progress in `[0, 1]`, derived from the current question's position
   * inside the room's runtime study. `null` when no runtime study is published
   * (caller should hide the percentage rather than guess).
   */
  progress: number | null
  /** Submit a structured answer over RPC. */
  submitAnswer: (answer: InterviewAnswerPayload) => Promise<void>
  /** Toggle the local microphone publish state. */
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>
  /** Toggle the local camera publish state (consent-gated by the caller). */
  setCameraEnabled: (enabled: boolean) => Promise<void>
  /** Toggle local screen-share publishing (consent-gated by the caller). */
  setScreenShareEnabled: (enabled: boolean) => Promise<void>
}

interface ConnectArgs {
  serverUrl: string
  token: string
}

const INITIAL_MEDIA: LocalMediaState = {
  micEnabled: false,
  cameraEnabled: false,
  screenShareEnabled: false,
}

/**
 * Connects the structured renderer to a live LiveKit room.
 *
 * This is the production transport boundary: `state` is hydrated from the
 * agent's `merism.interviewState` attribute, `transcript` from the LiveKit
 * transcription stream, and `submitAnswer` invokes the `merism.submit_answer`
 * RPC. The renderer consumes the same `question` shape it does in preview mode.
 */
export function useLiveInterview(args: ConnectArgs | null): LiveInterviewSession {
  const [phase, setPhase] = useState<TransportPhase>("idle")
  const [state, setState] = useState<InterviewAgentState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [media, setMedia] = useState<LocalMediaState>(INITIAL_MEDIA)
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null)
  const [runtimeStudy, setRuntimeStudy] = useState<InterviewRuntimeStudy | null>(null)
  const transportRef = useRef<InterviewTransport | null>(null)

  useEffect(() => {
    if (!args) return

    const transport = new InterviewTransport({
      onPhase: setPhase,
      onState: setState,
      onError: setError,
      onTranscription: (update) => setTranscript((prev) => mergeTranscript(prev, update)),
      onMetadata: (metadata: InterviewRoomMetadata) => setRuntimeStudy(metadata.runtimeStudy ?? null),
      onMediaState: setMedia,
      onLocalVideoTrack: setLocalVideoTrack,
    })
    transportRef.current = transport

    transport.connect(args.serverUrl, args.token).catch(() => {
      // Phase/error already surfaced via callbacks.
    })

    return () => {
      transportRef.current = null
      void transport.disconnect()
      setPhase("disconnected")
      setTranscript([])
      setMedia(INITIAL_MEDIA)
      setLocalVideoTrack(null)
    }
  }, [args])

  const submitAnswer = useCallback(async (answer: InterviewAnswerPayload) => {
    await transportRef.current?.submitAnswer(answer)
  }, [])

  const setMicrophoneEnabled = useCallback(async (enabled: boolean) => {
    await transportRef.current?.setMicrophoneEnabled(enabled)
  }, [])

  const setCameraEnabled = useCallback(async (enabled: boolean) => {
    await transportRef.current?.setCameraEnabled(enabled)
  }, [])

  const setScreenShareEnabled = useCallback(async (enabled: boolean) => {
    await transportRef.current?.setScreenShareEnabled(enabled)
  }, [])

  const question = state?.currentQuestion
  const completed = state?.status === "completed"
  const progress = useMemo(
    () => deriveProgress(runtimeStudy, state?.currentQuestionId),
    [runtimeStudy, state?.currentQuestionId],
  )

  return useMemo(
    () => ({
      phase,
      state,
      question,
      completed,
      error,
      transcript,
      media,
      localVideoTrack,
      progress,
      submitAnswer,
      setMicrophoneEnabled,
      setCameraEnabled,
      setScreenShareEnabled,
    }),
    [
      phase,
      state,
      question,
      completed,
      error,
      transcript,
      media,
      localVideoTrack,
      progress,
      submitAnswer,
      setMicrophoneEnabled,
      setCameraEnabled,
      setScreenShareEnabled,
    ],
  )
}

/** Upsert a transcript segment by id, preserving arrival order. */
function mergeTranscript(prev: TranscriptLine[], update: TranscriptSegmentUpdate): TranscriptLine[] {
  const index = prev.findIndex((line) => line.id === update.id)
  if (index === -1) return [...prev, update]
  const next = prev.slice()
  next[index] = update
  return next
}

/**
 * Map the current question to a `[0, 1]` progress fraction by its 1-based
 * position among all questions in the runtime study. Returns null when there is
 * no runtime study or the question cannot be located.
 */
function deriveProgress(
  runtimeStudy: InterviewRuntimeStudy | null,
  currentQuestionId: string | undefined,
): number | null {
  if (!runtimeStudy) return null
  const questionIds = runtimeStudy.sections.flatMap((section) =>
    section.questions.map((q) => q.questionId),
  )
  if (questionIds.length === 0) return null
  if (!currentQuestionId) return 0
  const index = questionIds.indexOf(currentQuestionId)
  if (index === -1) return null
  return (index + 1) / questionIds.length
}
