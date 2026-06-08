import { describe, expect, it } from "vitest";
import { calculateVideoSegmentSpecs } from "../src/video-segments";
import type { TranscriptRecord } from "../src/handler";

const transcript: TranscriptRecord = {
  $id: "tr1",
  sessionId: "sess1",
  language: "zh",
  segments: [
    { speaker: "agent", startMs: 0, endMs: 5_000, text: "请看这个概念。" },
    { speaker: "interviewee", startMs: 12_000, endMs: 20_000, text: "我需要想一下。" },
    { speaker: "interviewee", startMs: 72_000, endMs: 78_000, text: "这个价格有点高。" },
  ],
};

describe("video segment planning", () => {
  it("chunks the recording and maps transcript refs into each window", () => {
    const specs = calculateVideoSegmentSpecs(125_000, transcript, { chunkMs: 60_000 });
    expect(specs).toHaveLength(3);
    expect(specs[0]).toMatchObject({ id: "vseg_1", startMs: 0, endMs: 60_000 });
    expect(specs[0].transcriptRefs.map((ref) => ref.segmentIndex)).toEqual([0, 1]);
    expect(specs[1]).toMatchObject({ id: "vseg_2", startMs: 60_000, endMs: 120_000 });
    expect(specs[1].transcriptRefs.map((ref) => ref.segmentIndex)).toEqual([2]);
    expect(specs[2]).toMatchObject({ id: "vseg_3", startMs: 120_000, endMs: 125_000 });
  });

  it("merges a tiny tail into the previous segment", () => {
    const specs = calculateVideoSegmentSpecs(122_000, transcript, {
      chunkMs: 60_000,
      minSegmentMs: 10_000,
    });
    expect(specs).toHaveLength(2);
    expect(specs[1]).toMatchObject({ startMs: 60_000, endMs: 122_000 });
  });
});

