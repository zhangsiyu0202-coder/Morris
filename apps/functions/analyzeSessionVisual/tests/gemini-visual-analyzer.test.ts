import { describe, expect, it, vi } from "vitest";
import { uploadVideoToGemini } from "../src/gemini/upload-video";
import { analyzeVideoSegment } from "../src/gemini/analyze-segment";
import {
  createGeminiVisualAnalyzer,
  type GeminiVisualConfig,
} from "../src/gemini-visual-analyzer";
import type { GeminiClient } from "../src/gemini/client";
import type { VisualAnalysisInput } from "../src/visual-analysis";
import type { VideoSegmentSpec } from "../src/video-segments";

function makeClient(overrides: Partial<GeminiClient> = {}): GeminiClient & {
  uploadSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
  deleteSpy: ReturnType<typeof vi.fn>;
  generateSpy: ReturnType<typeof vi.fn>;
} {
  const uploadSpy = vi.fn();
  const getSpy = vi.fn();
  const deleteSpy = vi.fn(async () => undefined);
  const generateSpy = vi.fn();
  const client = {
    files: {
      upload: overrides.files?.upload ?? uploadSpy,
      get: overrides.files?.get ?? getSpy,
      delete: overrides.files?.delete ?? deleteSpy,
    },
    models: {
      generateContent: overrides.models?.generateContent ?? generateSpy,
    },
  } as GeminiClient;
  return Object.assign(client as any, { uploadSpy, getSpy, deleteSpy, generateSpy });
}

describe("uploadVideoToGemini", () => {
  it("polls until ACTIVE and returns the file uri", async () => {
    const client = makeClient();
    client.uploadSpy.mockResolvedValueOnce({
      name: "files/abc",
      uri: undefined,
      state: "PROCESSING",
      mimeType: "video/mp4",
    });
    client.getSpy.mockResolvedValueOnce({
      name: "files/abc",
      uri: "https://gem.googleapis/files/abc",
      state: "ACTIVE",
      mimeType: "video/mp4",
      videoMetadata: { videoDuration: "62.5s" },
    });

    const result = await uploadVideoToGemini({
      client,
      videoBytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      displayName: "session-1",
      pollIntervalMs: 1,
      now: () => 0,
      sleep: async () => undefined,
    });

    expect(client.uploadSpy).toHaveBeenCalledTimes(1);
    expect(client.getSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      fileUri: "https://gem.googleapis/files/abc",
      geminiFileName: "files/abc",
      mimeType: "video/mp4",
      durationSec: 62.5,
    });
  });

  it("times out, deletes the file, and throws", async () => {
    const client = makeClient();
    client.uploadSpy.mockResolvedValueOnce({ name: "files/abc", state: "PROCESSING" });
    client.getSpy.mockResolvedValue({ name: "files/abc", state: "PROCESSING" });

    let t = 0;
    await expect(
      uploadVideoToGemini({
        client,
        videoBytes: new Uint8Array([1]),
        mimeType: "video/mp4",
        displayName: "s1",
        pollIntervalMs: 1,
        maxWaitSeconds: 0.05,
        now: () => {
          t += 100;
          return t;
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("gemini_file_processing_timeout");

    expect(client.deleteSpy).toHaveBeenCalledWith({ name: "files/abc" });
  });

  it("rejects empty video bytes", async () => {
    const client = makeClient();
    await expect(
      uploadVideoToGemini({
        client,
        videoBytes: new Uint8Array([]),
        mimeType: "video/mp4",
        displayName: "s1",
      }),
    ).rejects.toThrow("video bytes are empty");
  });
});

describe("analyzeVideoSegment", () => {
  const baseSegment: VideoSegmentSpec = {
    id: "vseg_1",
    startMs: 5_000,
    endMs: 15_000,
    transcriptRefs: [],
  };

  it("formats start_offset/end_offset and parses structured JSON", async () => {
    const client = makeClient();
    client.generateSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "查看刺激物",
        description: "受访者短暂停顿。",
        observations: ["停顿了一下"],
        issueLevel: "minor",
        candidateMoments: [
          { timestampMs: 7_000, label: "停顿", description: "回答前停顿" },
          // out-of-window moment should be clamped, not rejected
          { timestampMs: 999_999, label: "越界", description: "测试 clamp" },
        ],
      }),
    });

    const result = await analyzeVideoSegment({
      client,
      fileUri: "https://gem/files/abc",
      mimeType: "video/mp4",
      model: "gemini-2.5-flash-lite",
      segment: baseSegment,
      prompt: "analyze this segment",
    });

    const call = client.generateSpy.mock.calls[0][0];
    expect(call.model).toBe("gemini-2.5-flash-lite");
    expect(call.config).toMatchObject({ responseMimeType: "application/json" });
    const parts = call.contents[0].parts;
    expect(parts[0].fileData).toEqual({ fileUri: "https://gem/files/abc", mimeType: "video/mp4" });
    expect(parts[0].videoMetadata).toEqual({ startOffset: "5.00s", endOffset: "15.00s" });
    expect(parts[1].text).toBe("analyze this segment");

    expect(result).toMatchObject({
      segmentId: "vseg_1",
      title: "查看刺激物",
      description: "受访者短暂停顿。",
      observations: ["停顿了一下"],
      issueLevel: "minor",
    });
    // Out-of-window timestamp clamped to segment end
    expect(result.candidateMoments).toEqual([
      { timestampMs: 7_000, label: "停顿", description: "回答前停顿" },
      { timestampMs: 15_000, label: "越界", description: "测试 clamp" },
    ]);
  });

  it("strips ```json fences before parsing", async () => {
    const client = makeClient();
    client.generateSpy.mockResolvedValueOnce({
      text: '```json\n{"title":"t","description":"d","observations":[],"issueLevel":"none","candidateMoments":[]}\n```',
    });
    const result = await analyzeVideoSegment({
      client,
      fileUri: "u",
      mimeType: "video/mp4",
      model: "m",
      segment: baseSegment,
      prompt: "p",
    });
    expect(result.title).toBe("t");
  });

  it("throws when the model returns no text", async () => {
    const client = makeClient();
    client.generateSpy.mockResolvedValueOnce({});
    await expect(
      analyzeVideoSegment({
        client,
        fileUri: "u",
        mimeType: "video/mp4",
        model: "m",
        segment: baseSegment,
        prompt: "p",
      }),
    ).rejects.toThrow("gemini segment analysis returned no text");
  });
});

describe("createGeminiVisualAnalyzer (orchestrator)", () => {
  const config: GeminiVisualConfig = {
    baseUrl: "https://worker.example/",
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    maxBytes: 10 * 1024 * 1024,
    uploadMaxWaitSec: 5,
    segmentParallelism: 2,
    minSuccessRatio: 0.5,
  };

  const baseInput: VisualAnalysisInput = {
    sessionId: "sess1",
    recording: {
      $id: "rec1",
      sessionId: "sess1",
      ownerUserId: "u1",
      storageFileId: "file-sess1",
      durationMs: 60_000,
      format: "mp4",
    },
    transcript: {
      $id: "tr1",
      sessionId: "sess1",
      language: "zh",
      segments: [{ speaker: "interviewee", startMs: 0, endMs: 1_000, text: "你好。" }],
    },
    media: { bytes: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" },
    segmentSpecs: [
      { id: "vseg_1", startMs: 0, endMs: 30_000, transcriptRefs: [] },
      { id: "vseg_2", startMs: 30_000, endMs: 60_000, transcriptRefs: [] },
    ],
  };

  it("uploads once, analyzes each segment in parallel, consolidates, then cleans up", async () => {
    const client = makeClient();
    client.uploadSpy.mockResolvedValueOnce({
      name: "files/abc",
      uri: "https://gem/files/abc",
      state: "ACTIVE",
      mimeType: "video/mp4",
      videoMetadata: { videoDuration: "60s" },
    });
    client.generateSpy.mockResolvedValue({
      text: JSON.stringify({
        title: "T",
        description: "D",
        observations: ["o"],
        issueLevel: "none",
        candidateMoments: [],
      }),
    });
    const consolidator = vi.fn(async () => ({
      summary: "整体平稳",
      sentiment: "neutral" as const,
      tags: ["engaged"],
      keyMoments: [],
    }));

    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config });
    const result = await analyzer(baseInput);

    expect(client.uploadSpy).toHaveBeenCalledTimes(1);
    expect(client.generateSpy).toHaveBeenCalledTimes(2); // one per segment
    expect(consolidator).toHaveBeenCalledTimes(1);
    expect(client.deleteSpy).toHaveBeenCalledWith({ name: "files/abc" });
    expect(result).toMatchObject({
      source: "recording",
      recordingFileId: "file-sess1",
      visualConfirmation: true,
      summary: "整体平稳",
      sentiment: "neutral",
    });
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.id).toBe("vseg_1");
    expect(result.modelId).toBe("gemini-2.5-flash-lite");
  });

  it("returns partial result with failed_segments tag when one segment fails but ratio is met", async () => {
    const client = makeClient();
    client.uploadSpy.mockResolvedValueOnce({
      name: "files/abc",
      uri: "https://gem/files/abc",
      state: "ACTIVE",
      mimeType: "video/mp4",
    });
    client.generateSpy
      .mockResolvedValueOnce({
        text: JSON.stringify({
          title: "T",
          description: "D",
          observations: [],
          issueLevel: "none",
          candidateMoments: [],
        }),
      })
      .mockRejectedValueOnce(new Error("upstream 503"));

    const consolidator = vi.fn(async () => ({
      summary: "部分时段未能分析",
      sentiment: "neutral" as const,
      tags: ["partial"],
      keyMoments: [],
    }));
    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config });
    const result = await analyzer(baseInput);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.id).toBe("vseg_1");
    expect(result.tags).toContain("partial");
    expect(result.tags.some((t) => t.startsWith("failed_segments:"))).toBe(true);
    expect(client.deleteSpy).toHaveBeenCalled();
  });

  it("throws and cleans up when too many segments fail (below minSuccessRatio)", async () => {
    const strictConfig: GeminiVisualConfig = { ...config, minSuccessRatio: 0.9 };
    const client = makeClient();
    client.uploadSpy.mockResolvedValueOnce({
      name: "files/abc",
      uri: "https://gem/files/abc",
      state: "ACTIVE",
      mimeType: "video/mp4",
    });
    client.generateSpy.mockRejectedValue(new Error("upstream timeout"));
    const consolidator = vi.fn();

    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config: strictConfig });
    await expect(analyzer(baseInput)).rejects.toThrow(/gemini_visual_too_many_segment_failures/);
    expect(consolidator).not.toHaveBeenCalled();
    expect(client.deleteSpy).toHaveBeenCalledWith({ name: "files/abc" });
  });

  it("falls back to deterministic summary when consolidator throws (still returns success)", async () => {
    const client = makeClient();
    client.uploadSpy.mockResolvedValueOnce({
      name: "files/abc",
      uri: "https://gem/files/abc",
      state: "ACTIVE",
      mimeType: "video/mp4",
    });
    client.generateSpy.mockResolvedValue({
      text: JSON.stringify({
        title: "T",
        description: "D",
        observations: ["watched stimulus"],
        issueLevel: "minor",
        candidateMoments: [],
      }),
    });
    const consolidator = vi.fn(async () => {
      throw new Error("deepseek unavailable");
    });

    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config });
    const result = await analyzer(baseInput);

    expect(result.tags).toContain("consolidation_fallback");
    expect(result.tags.some((t) => t.startsWith("consolidator_error"))).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(client.deleteSpy).toHaveBeenCalledWith({ name: "files/abc" });
  });

  it("downgrades positive sentiment to mixed when a segment reports a major issue (Gap 4b)", async () => {
    const client = makeClient();
    client.uploadSpy.mockResolvedValueOnce({
      name: "files/abc",
      uri: "https://gem/files/abc",
      state: "ACTIVE",
      mimeType: "video/mp4",
    });
    client.generateSpy.mockResolvedValue({
      text: JSON.stringify({
        title: "T",
        description: "D",
        observations: [],
        issueLevel: "major",
        candidateMoments: [],
      }),
    });
    const consolidator = vi.fn(async () => ({
      summary: "看似顺畅",
      sentiment: "positive" as const,
      tags: ["engaged"],
      keyMoments: [],
    }));

    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config });
    const result = await analyzer(baseInput);

    expect(result.sentiment).toBe("mixed");
  });

  it("rejects empty media without uploading", async () => {
    const client = makeClient();
    const consolidator = vi.fn();
    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config });
    await expect(
      analyzer({ ...baseInput, media: { bytes: new Uint8Array([]), mimeType: "video/mp4" } }),
    ).rejects.toThrow("recording is empty");
    expect(client.uploadSpy).not.toHaveBeenCalled();
  });

  it("rejects oversize media without uploading", async () => {
    const client = makeClient();
    const consolidator = vi.fn();
    const tinyConfig: GeminiVisualConfig = { ...config, maxBytes: 2 };
    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config: tinyConfig });
    await expect(
      analyzer({ ...baseInput, media: { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "video/mp4" } }),
    ).rejects.toThrow(/exceeds GEMINI_VIDEO_MAX_BYTES/);
    expect(client.uploadSpy).not.toHaveBeenCalled();
  });

  it("returns an empty visual analysis when there are no segments", async () => {
    const client = makeClient();
    const consolidator = vi.fn();
    const analyzer = createGeminiVisualAnalyzer({ client, consolidator, config });
    const result = await analyzer({ ...baseInput, segmentSpecs: [] });
    expect(result.segments).toHaveLength(0);
    expect(result.visualConfirmation).toBe(false);
    expect(client.uploadSpy).not.toHaveBeenCalled();
    expect(consolidator).not.toHaveBeenCalled();
  });
});
