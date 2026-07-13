import { inference } from "@livekit/agents";

export function buildVoiceWorkerTurnDetection() {
  return new inference.TurnDetector({ version: "v1-mini" });
}
