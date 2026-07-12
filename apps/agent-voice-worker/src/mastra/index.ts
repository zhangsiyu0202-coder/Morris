import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { liveKitConnectionRoute } from "@mastra/livekit";

import { voiceWorkerModel } from "./model";

export const voiceInterviewAgent = new Agent({
  id: "voiceInterview",
  name: "Merism Voice Interview Agent",
  instructions: [
    "You are the TypeScript voice interview worker for Merism.",
    "Keep replies short, conversational, and easy to interrupt.",
    "Follow the interview outline and supervisor instruction supplied in room metadata when present."
  ].join(" "),
  model: voiceWorkerModel
});

/**
 * Source:
 * https://mastra.ai/docs/voice/livekit
 *
 * Official topology: the Mastra HTTP process exposes a connection-details
 * route, while the actual LiveKit worker runs in a separate process.
 */
export const mastra = new Mastra({
  agents: {
    voiceInterview: voiceInterviewAgent
  },
  server: {
    apiRoutes: [
      liveKitConnectionRoute({
        agentName: "merism-mastra-voice-worker"
      })
    ]
  }
});
