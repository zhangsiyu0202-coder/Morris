// Consolidate per-segment Gemini outputs into a session-level visual summary.
//
// PostHog's a6_consolidate_video_segments uses Gemini for this step too,
// because Gemini is the only LLM in their stack. Merism diverges: this step
// is pure text reasoning over the per-segment outputs (no video) and we run
// it on DeepSeek — the project's primary LLM — to keep Gemini's footprint
// limited strictly to "must see pixels" steps (i.e. analyze-segment.ts).
// The implementing call lives in deepseek-consolidator.ts; this file holds
// the shared Consolidator interface plus a deterministic fallback used
// when the LLM consolidator fails.

import type {
  ConsolidatedSummary,
  SegmentLlmOutput,
} from "./types.js";

export type { ConsolidatedSummary };

export interface ConsolidateInputs {
  segments: SegmentLlmOutput[];
  /** Total expected segment count (so the LLM knows how many failed). */
  expectedSegmentCount: number;
  /** Original transcript text for context (joined as plain text). */
  transcriptText: string;
}

export type Consolidator = (inputs: ConsolidateInputs) => Promise<ConsolidatedSummary>;

/**
 * Deterministic fallback: build a ConsolidatedSummary without calling an LLM.
 *
 * Used when:
 *   - Every segment failed (we have nothing to consolidate).
 *   - The injected consolidator throws (we still want a degraded result).
 *
 * The output is intentionally plain — it surfaces enough info for the
 * researcher to know the analysis ran but model-driven narrative was unavailable.
 */
export function buildFallbackSummary(inputs: ConsolidateInputs): ConsolidatedSummary {
  const { segments, expectedSegmentCount } = inputs;
  const observed = segments.length;

  const sentimentCounts = segments.reduce<Record<ConsolidatedSummary["sentiment"], number>>(
    (acc, seg) => {
      const tone = inferTone(seg);
      acc[tone] = (acc[tone] ?? 0) + 1;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0, mixed: 0 },
  );
  const sentiment =
    (Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as ConsolidatedSummary["sentiment"]) ??
    "neutral";

  const tagSet = new Set<string>();
  for (const seg of segments) {
    if (seg.issueLevel !== "none") tagSet.add(`issue-${seg.issueLevel}`);
    for (const obs of seg.observations) {
      const word = obs
        .split(/\s|[，。、,;:!?]/)
        .find((w) => w.length >= 2 && w.length <= 16);
      if (word) tagSet.add(word);
      if (tagSet.size >= 8) break;
    }
    if (tagSet.size >= 8) break;
  }

  const moments = segments
    .flatMap((seg) =>
      seg.candidateMoments.map((m, idx) => ({
        id: `vmoment_${seg.segmentId}_${idx + 1}`,
        timestampMs: m.timestampMs,
        label: m.label,
        description: m.description,
        segmentId: seg.segmentId,
      })),
    )
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(0, 8);

  const summaryParts: string[] = [];
  summaryParts.push(`已分析 ${observed} / ${expectedSegmentCount} 个视频时段。`);
  if (observed === 0) {
    summaryParts.push("没有可用的视觉观察结果（所有时段调用都失败或被丢弃）。");
  } else {
    summaryParts.push("以下汇总为各时段标题的合并：");
    summaryParts.push(segments.map((s) => `· ${s.title}`).join("\n"));
  }
  return {
    summary: summaryParts.join("\n"),
    sentiment,
    tags: Array.from(tagSet),
    keyMoments: moments,
  };
}

function inferTone(seg: SegmentLlmOutput): ConsolidatedSummary["sentiment"] {
  if (seg.issueLevel === "major") return "negative";
  if (seg.issueLevel === "minor") return "mixed";
  return "neutral";
}
