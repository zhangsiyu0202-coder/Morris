import { describe, expect, it } from "vitest";

import { SessionTranscriptCollector } from "./transcript-collector.js";

describe("SessionTranscriptCollector", () => {
  it("stores final user STT events as chronological interviewee transcript segments", () => {
    const collector = new SessionTranscriptCollector({ startedAt: 1_000 });

    collector.record({
      transcript: " interim text ",
      isFinal: false,
      itemId: "turn-1",
      speakerId: null,
      createdAt: 1_100,
      language: "zh",
    });
    collector.record({
      transcript: "  第一段回答  ",
      isFinal: true,
      itemId: "turn-1",
      speakerId: null,
      createdAt: 1_200,
      language: "zh",
    });
    collector.record({
      transcript: "第二段回答",
      isFinal: true,
      itemId: "turn-2",
      speakerId: null,
      createdAt: 1_750,
      language: "zh",
    });

    expect(collector.snapshot).toEqual({
      language: "zh",
      segments: [
        { speaker: "interviewee", startMs: 200, endMs: 200, text: "第一段回答" },
        { speaker: "interviewee", startMs: 750, endMs: 750, text: "第二段回答" },
      ],
    });
  });

  it("omits an empty transcript and never creates a negative timestamp", () => {
    const collector = new SessionTranscriptCollector({ startedAt: 1_000 });

    collector.record({
      transcript: "   ",
      isFinal: true,
      itemId: null,
      speakerId: null,
      createdAt: 900,
      language: null,
    });
    collector.record({
      transcript: "开始前到达的 final",
      isFinal: true,
      itemId: null,
      speakerId: null,
      createdAt: 900,
      language: null,
    });

    expect(collector.snapshot).toEqual({
      language: "zh",
      segments: [
        {
          speaker: "interviewee",
          startMs: 0,
          endMs: 0,
          text: "开始前到达的 final",
        },
      ],
    });
  });

  it("deduplicates retried final events only when LiveKit supplies an item id", () => {
    const collector = new SessionTranscriptCollector({ startedAt: 1_000 });
    const event = {
      transcript: "一次回答",
      isFinal: true,
      itemId: "turn-1",
      speakerId: null,
      createdAt: 1_200,
      language: "zh",
    };

    collector.record(event);
    collector.record(event);

    expect(collector.snapshot?.segments).toEqual([
      { speaker: "interviewee", startMs: 200, endMs: 200, text: "一次回答" },
    ]);
  });
});
