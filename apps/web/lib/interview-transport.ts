import {
  type DataPacket_Kind,
  type Participant,
  type RemoteParticipant,
  Room,
  RoomEvent,
} from "livekit-client"
import {
  INTERVIEW_STATE_ATTRIBUTE,
  type InterviewAgentState,
  InterviewAgentStateSchema,
  type InterviewAnswerPayload,
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

export interface InterviewTransportCallbacks {
  onPhase?: (phase: TransportPhase) => void
  onState?: (state: InterviewAgentState) => void
  onError?: (message: string) => void
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

  async connect(serverUrl: string, token: string): Promise<void> {
    this.callbacks.onPhase?.("connecting")
    try {
      await this.room.connect(serverUrl, token)
      this.callbacks.onPhase?.("connected")
      this.refreshAgent()
    } catch (error) {
      this.callbacks.onPhase?.("error")
      this.callbacks.onError?.(error instanceof Error ? error.message : "connect_failed")
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect()
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
      .on(RoomEvent.Reconnecting, () => this.callbacks.onPhase?.("reconnecting"))
      .on(RoomEvent.Reconnected, () => {
        this.callbacks.onPhase?.("connected")
        this.refreshAgent()
      })
      .on(RoomEvent.Disconnected, () => this.callbacks.onPhase?.("disconnected"))
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
