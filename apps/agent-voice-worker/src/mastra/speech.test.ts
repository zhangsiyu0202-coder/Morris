import { afterEach, describe, expect, it, vi } from "vitest";

import { buildVoiceWorkerSpeechProviders } from "./speech.js";

describe("buildVoiceWorkerSpeechProviders", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses FunASR Flash STT and delegates VAD to Mastra's Silero default", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "test-key");

    const providers = buildVoiceWorkerSpeechProviders();

    expect(providers.stt.label).toBe("dashscope.fun-asr-flash.STT");
    expect(providers).not.toHaveProperty("vad");
  });
});
