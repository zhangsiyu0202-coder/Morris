import { describe, expect, it } from "vitest";
import { inference } from "@livekit/agents";

import { buildVoiceWorkerTurnDetection } from "./turn-detection.js";

describe("buildVoiceWorkerTurnDetection", () => {
  it("uses the local v1-mini turn detector", () => {
    const turnDetection = buildVoiceWorkerTurnDetection();

    expect(turnDetection).toBeInstanceOf(inference.TurnDetector);
    expect(
      (turnDetection as unknown as { _model: string })._model,
    ).toBe("turn-detector-v1-mini");
  });
});
