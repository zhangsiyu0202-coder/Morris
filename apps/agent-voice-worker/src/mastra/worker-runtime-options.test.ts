import { describe, expect, it } from "vitest";

import { buildVoiceWorkerServerOptions } from "./worker-runtime-options.js";

describe("buildVoiceWorkerServerOptions", () => {
  it("keeps one initialized idle process so Mastra's Silero VAD prewarm is ready before a job", () => {
    expect(buildVoiceWorkerServerOptions({})).toEqual({
      initializeProcessTimeout: 60_000,
      numIdleProcesses: 1,
    });
  });

  it("allows explicit positive worker pool sizing", () => {
    expect(
      buildVoiceWorkerServerOptions({
        LIVEKIT_INIT_PROCESS_TIMEOUT_MS: "90000",
        LIVEKIT_NUM_IDLE_PROCESSES: "2",
      }),
    ).toEqual({
      initializeProcessTimeout: 90_000,
      numIdleProcesses: 2,
    });
  });

  it("fails fast for an invalid idle-worker setting instead of silently disabling prewarm", () => {
    expect(() => buildVoiceWorkerServerOptions({ LIVEKIT_NUM_IDLE_PROCESSES: "0" })).toThrow(
      "LIVEKIT_NUM_IDLE_PROCESSES",
    );
  });
});
