import {
  type DataPacket_Kind,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  type TranscriptionSegment,
} from "livekit-client"
import {
  INTERVIEW_STATE_ATTRIBUTE,
  type InterviewAgentState,
  InterviewAgentStateSchema,
  type InterviewAnswerPayload,
  type InterviewRoomMetadata,
  InterviewRoomMetadataSchema,
  type SubmitInterviewAnswerRpcResponse,
  SUBMIT_ANSWER_RPC_METHOD,
} from "@merism/contracts"

export type TransportPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error"

/** Who produced a transcript segment, from the interviewee's point of view. */
export type TranscriptSpeaker = "agent" | "you"

/**
 * A single transcript update lifted off the LiveKit transcription stream.
 * Segments arrive interim-then-final under a stable `id`, so the consumer
 * upserts by id rather than appending blindly.
 */
export interface TranscriptSegmentUpdate {
  id: string
  text: string
  final: boolean
  speaker: TranscriptSpeaker
}

/** Snapshot of which local media tracks are currently publishing. */
export interface LocalMediaState {
  micEnabled: boolean
  cameraEnabled: boolean
  screenShareEnabled: boolean
}

export interface InterviewTransportCallbacks {
  onPhase?: (phase: TransportPhase) => void
  onState?: (state: InterviewAgentState) => void
  onError?: (message: string) => void
  /** A transcript segment (interim or final) from the agent or the local user. */
  onTranscription?: (update: TranscriptSegmentUpdate) => void
  /** Parsed room metadata, used to derive interview progress. */
  onMetadata?: (metadata: InterviewRoomMetadata) => void
  /** Latest local mic/camera/screenshare publish state. */
  onMediaState?: (state: LocalMediaState) => void
  /** The local camera track for self-view rendering, or null when off. */
  onLocalVideoTrack?: (track: LocalVideoTrack | null) => void
}

/** Parse and validate a raw `room.metadata` JSON string. Returns null when absent/invalid. */
export function parseRoomMetadata(raw: string | undefined | null): InterviewRoomMetadata | null {
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = InterviewRoomMetadataSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/**
 * Parse and validate a raw `merism.interviewState` attribute value.
 *
 * Pure and framework-free so it can be unit-tested without a live room.
 * Returns `null` for missing/invalid payloads rather than throwing — the
 * renderer simply keeps showing the previous question until a valid state
 * arrives.
 */
export function parseAgentState(raw: string | undefined | null): InterviewAgentState | null {
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = InterviewAgentStateSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/**
 * Decide which remote participant is the interview agent.
 *
 * Preference order: the participant currently publishing the interview-state
 * attribute, then any participant whose kind reports as an agent. Identity is
 * needed as the RPC destination for answer submission.
 */
export function selectAgentParticipant(
  participants: Iterable<RemoteParticipant>,
): RemoteParticipant | null {
  let agentByKind: RemoteParticipant | null = null
  for (const participant of participants) {
    if (participant.attributes?.[INTERVIEW_STATE_ATTRIBUTE]) {
      return participant
    }
    if (isAgentParticipant(participant) && agentByKind === null) {
      agentByKind = participant
    }
  }
  return agentByKind
}

function isAgentParticipant(participant: Participant): boolean {
  // `kind` is the string/enum "agent" across livekit-client versions; guard
  // defensively since older builds may not expose it.
  const kind = (participant as { kind?: unknown }).kind
  return kind === "agent" || kind === 3
}

/**
 * Framework-agnostic LiveKit transport for the interviewee side.
 *
 * Responsibilities:
 *  - connect to the room with an issued token
 *  - track the agent participant and surface its `merism.interviewState`
 *  - submit structured answers over the `merism.submit_answer` RPC
 *
 * The React layer wraps this; the renderer never imports livekit-client.
 */
export class InterviewTransport {
  private readonly room: Room
  private readonly callbacks: InterviewTransportCallbacks
  private agentIdentity: string | null = null

  constructor(callbacks: InterviewTransportCallbacks = {}) {
    this.room = new Room()
    this.callbacks = callbacks
    this.wireRoomEvents()
  }

  /** The underlying LiveKit room, for `@livekit/components-react` RoomContext
   * (e.g. the voice visualizer). Stable for the transport's lifetime. */
  getRoom(): Room {
    return this.room
  }

  async connect(serverUrl: string, token: string): Promise<void> {
    this.callbacks.onPhase?.("connecting")
    try {
      await this.room.connect(serverUrl, token)
      this.callbacks.onPhase?.("connected")
      this.refreshAgent()
      this.emitMetadata()
      // Voice interview: the microphone is the primary input channel, so we
      // publish it as soon as we are in the room. The browser permission was
      // already obtained inside the pre-interview flow's `PermissionStage`
      // (which calls LiveKit's `createLocalAudioTrack` and only advances on a
      // granted permission), so this call is a publish action. Camera /
      // screenshare stay off until the interviewee explicitly opts in inside
      // the room shell.
      await this.setMicrophoneEnabled(true)
    } catch (error) {
      this.callbacks.onPhase?.("error")
      this.callbacks.onError?.(error instanceof Error ? error.message : "connect_failed")
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect()
  }

  /** Toggle the microphone publish state. */
  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.toggleMedia(() => this.room.localParticipant.setMicrophoneEnabled(enabled), "microphone_failed")
  }

  /** Toggle the camera publish state and surface the local track for self-view. */
  async setCameraEnabled(enabled: boolean): Promise<void> {
    await this.toggleMedia(() => this.room.localParticipant.setCameraEnabled(enabled), "camera_failed")
    this.emitLocalVideoTrack()
  }

  /** Toggle screen-share publishing. */
  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    await this.toggleMedia(
      () => this.room.localParticipant.setScreenShareEnabled(enabled),
      "screenshare_failed",
    )
  }

  /**
   * Run a media-publish toggle, then re-emit the media snapshot. Device/permission
   * failures are expected (user denies prompt, no device) — surface them via
   * `onError` and keep the snapshot consistent rather than tearing down the room.
   */
  private async toggleMedia(action: () => Promise<unknown>, errorCode: string): Promise<void> {
    try {
      await action()
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : errorCode)
    } finally {
      this.emitMediaState()
    }
  }

  /** Submit a structured answer; resolves with the agent's RPC acknowledgement. */
  async submitAnswer(
    answer: InterviewAnswerPayload,
  ): Promise<SubmitInterviewAnswerRpcResponse | null> {
    if (!this.agentIdentity) {
      this.callbacks.onError?.("agent_unavailable")
      return null
    }
    const raw = await this.room.localParticipant.performRpc({
      destinationIdentity: this.agentIdentity,
      method: SUBMIT_ANSWER_RPC_METHOD,
      payload: JSON.stringify({ answer }),
    })
    try {
      return JSON.parse(raw) as SubmitInterviewAnswerRpcResponse
    } catch {
      return null
    }
  }

  private wireRoomEvents(): void {
    this.room
      .on(RoomEvent.ParticipantConnected, () => this.refreshAgent())
      .on(RoomEvent.ParticipantDisconnected, () => this.refreshAgent())
      .on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
        this.handleAttributes(participant)
      })
      .on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        this.handleTranscription(segments, participant)
      })
      .on(RoomEvent.RoomMetadataChanged, () => this.emitMetadata())
      .on(RoomEvent.LocalTrackPublished, () => {
        this.emitMediaState()
        this.emitLocalVideoTrack()
      })
      .on(RoomEvent.LocalTrackUnpublished, () => {
        this.emitMediaState()
        this.emitLocalVideoTrack()
      })
      .on(RoomEvent.Reconnecting, () => this.callbacks.onPhase?.("reconnecting"))
      .on(RoomEvent.Reconnected, () => {
        this.callbacks.onPhase?.("connected")
        this.refreshAgent()
      })
      .on(RoomEvent.Disconnected, () => this.callbacks.onPhase?.("disconnected"))
  }

  /** Forward each transcription segment, tagging the speaker as agent or local user. */
  private handleTranscription(segments: TranscriptionSegment[], participant?: Participant): void {
    if (!this.callbacks.onTranscription) return
    const speaker: TranscriptSpeaker = participant?.isLocal ? "you" : "agent"
    for (const segment of segments) {
      this.callbacks.onTranscription({
        id: segment.id,
        text: segment.text,
        final: segment.final,
        speaker,
      })
    }
  }

  private emitMetadata(): void {
    const metadata = parseRoomMetadata(this.room.metadata)
    if (metadata) this.callbacks.onMetadata?.(metadata)
  }

  private emitMediaState(): void {
    const local = this.room.localParticipant
    this.callbacks.onMediaState?.({
      micEnabled: local.isMicrophoneEnabled,
      cameraEnabled: local.isCameraEnabled,
      screenShareEnabled: local.isScreenShareEnabled,
    })
  }

  private emitLocalVideoTrack(): void {
    const track: LocalVideoTrack | null =
      this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null
    this.callbacks.onLocalVideoTrack?.(track)
  }

  /** Re-scan remote participants for the agent and read its current state. */
  private refreshAgent(): void {
    const agent = selectAgentParticipant(this.room.remoteParticipants.values())
    if (!agent) return
    this.agentIdentity = agent.identity
    this.handleAttributes(agent)
  }

  private handleAttributes(participant: Participant): void {
    const raw = participant.attributes?.[INTERVIEW_STATE_ATTRIBUTE]
    const state = parseAgentState(raw)
    if (!state) return
    this.agentIdentity = participant.identity
    this.callbacks.onState?.(state)
  }
}

// Re-exported only so consumers don't need a direct livekit-client import for
// the data-packet type when extending the transport.
export type { DataPacket_Kind }
