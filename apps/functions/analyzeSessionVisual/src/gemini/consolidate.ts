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

/** Caps applied to consolidator output (LLM or fallback) before it reaches the schema. */
export const MAX_KEY_MOMENTS = 8;
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;

/**
 * Validate and clamp a ConsolidatedSummary against the observed per-segment
 * signals. Mirrors PostHog's `_validate_and_clamp_sentiment` intent: the LLM's
 * free-form output must not contradict the deterministic segment evidence.
 *
 * Applied once, centrally, in the orchestrator — so it guards BOTH the DeepSeek
 * path and the deterministic fallback path with the same invariants:
 *   - sentiment cannot be "positive" when a segment carries a major issue
 *     (downgraded to "mixed"); a minor issue alone may still be "positive".
 *   - keyMoments are dropped if label/description is empty, sorted by time,
 *     and capped at MAX_KEY_MOMENTS.
 *   - tags are trimmed, de-duplicated, length-bounded, emptied-dropped, and
 *     capped at MAX_TAGS.
 *
 * Pure: no I/O, no mutation of the input.
 */
export function validateAndClampConsolidatedSummary(
  summary: ConsolidatedSummary,
  segments: SegmentLlmOutput[],
): ConsolidatedSummary {
  const hasMajorIssue = segments.some((s) => s.issueLevel === "major");

  let sentiment = summary.sentiment;
  if (hasMajorIssue && sentiment === "positive") {
    sentiment = "mixed";
  }

  const keyMoments = summary.keyMoments
    .filter((m) => m.label.trim().length > 0 && m.description.trim().length > 0)
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(0, MAX_KEY_MOMENTS);

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of summary.tags) {
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }

  return { summary: summary.summary, sentiment, tags, keyMoments };
}

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
