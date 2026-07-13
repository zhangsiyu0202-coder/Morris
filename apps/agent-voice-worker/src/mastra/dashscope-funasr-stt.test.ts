import { describe, expect, it } from "vitest";
import { stt } from "@livekit/agents";

import { toFunAsrSpeechEvents } from "./dashscope-funasr-stt.js";

describe("toFunAsrSpeechEvents", () => {
  it("keeps a server-VAD sentence boundary out of LiveKit turn decisions", () => {
    const events = toFunAsrSpeechEvents(
      {
        begin_time: 170,
        end_time: 920,
        text: "好的，我明白了。",
        sentence_end: true,
      },
      "zh",
      3,
    );

    expect(events.map((event) => event.type)).toEqual([
      stt.SpeechEventType.FINAL_TRANSCRIPT,
      stt.SpeechEventType.RECOGNITION_USAGE,
    ]);
  });
});
