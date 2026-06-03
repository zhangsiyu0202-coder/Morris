import {
  INTERVIEW_STATE_ATTRIBUTE,
  InterviewAgentStateSchema,
  InterviewRoomMetadataSchema,
} from "@merism/contracts";
import type { Participant, Room } from "livekit-client";
import { z } from "zod";

type InterviewAgentState = z.infer<typeof InterviewAgentStateSchema>;
type InterviewRoomMetadata = z.infer<typeof InterviewRoomMetadataSchema>;

export function parseInterviewRoomMetadata(raw: string | undefined): InterviewRoomMetadata | null {
  if (!raw) {
    return null;
  }

  try {
    return InterviewRoomMetadataSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseInterviewAgentState(
  participant: Participant | undefined,
): InterviewAgentState | null {
  const raw = participant?.attributes[INTERVIEW_STATE_ATTRIBUTE];
  if (!raw) {
    return null;
  }

  try {
    return InterviewAgentStateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function findAgentParticipant(room: Room): Participant | undefined {
  return Array.from(room.remoteParticipants.values())[0];
}
