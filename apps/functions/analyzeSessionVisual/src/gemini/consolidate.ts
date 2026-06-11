// Consolidate per-segment Gemini outputs into a session-level visual summary.
//
// PostHog's a6_consolidate_video_segments uses Gemini for this step too,
// because Gemini is the only LLM in their stack. Merism diverges: this step
// is pure text reasoning over the per-segment outputs (no video) and we run
// it on DeepSeek. This file holds the shared Consolidator interface, the
// PostHog-parity validate/clamp (sentiment + numeric frustration floors + tag
// sanitization), and a deterministic fallback used when the LLM consolidator
// fails.

import { VISUAL_TAG_TAXONOMY } from "@merism/contracts";
import type { ConsolidatedSummary, SegmentLlmOutput } from "./types.js";

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
export const MAX_FIXED_TAGS = 5;
export const MAX_FREEFORM_TAGS = 5;

const FREEFORM_TAG_RE = /^[a-z0-9_]{1,64}$/;
// PostHog OUTCOME_SCORE_FLOORS parity.
const OUTCOME_SCORE_FLOORS: Record<NonNullable<ConsolidatedSummary["outcome"]>, number> = {
  successful: 0,
  friction: 0.2,
  frustrated: 0.5,
  blocked: 0.75,
};

/**
 * Validate and clamp a ConsolidatedSummary against the observed per-segment
 * signals. Mirrors PostHog's `_validate_and_clamp_sentiment`: the LLM's
 * free-form output must not contradict the deterministic segment evidence.
 *
 * Applied once, centrally, in the orchestrator — guards BOTH the DeepSeek path
 * and the deterministic fallback path:
 *   - sentiment cannot be "positive" when a segment carries a major issue.
 *   - keyMoments drop-empty / sorted / capped.
 *   - tags trimmed / de-duped / length-bounded / capped.
 *   - frustrationScore floored by (a) the observed segment issues
 *     (signal_floor) and (b) the stated outcome (OUTCOME_SCORE_FLOORS), then
 *     clamped to [0,1]; signals referencing non-existent segments are dropped.
 *   - tagsFixed filtered to the fixed taxonomy; tagsFreeform regex-sanitized;
 *     both capped; highlighted coerced to a strict boolean.
 *
 * Pure: no I/O, no mutation of the input.
 */
export function validateAndClampConsolidatedSummary(
  summary: ConsolidatedSummary,
  segments: SegmentLlmOutput[],
): ConsolidatedSummary {
  const n = segments.length;
  const hasMajorIssue = segments.some((s) => s.issueLevel === "major");

  let sentiment = summary.sentiment;
  if (hasMajorIssue && sentiment === "positive") sentiment = "mixed";

  const keyMoments = summary.keyMoments
    .filter((m) => m.label.trim().length > 0 && m.description.trim().length > 0)
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(0, MAX_KEY_MOMENTS);

  const tags = sanitize(summary.tags ?? [], MAX_TAGS, MAX_TAG_LENGTH);

  // --- Gap D: numeric frustration model ---
  const outcome = summary.outcome ?? "successful";
  const nMinor = segments.filter((s) => s.issueLevel === "minor").length;
  const nMajor = segments.filter((s) => s.issueLevel === "major").length;
  const signalFloor = n > 0 ? Math.min((nMinor + nMajor * 2) / n, 1) * 0.5 : 0;
  const outcomeFloor = OUTCOME_SCORE_FLOORS[outcome] ?? 0;
  let score = summary.frustrationScore ?? 0;
  score = Math.max(score, signalFloor, outcomeFloor);
  const frustrationScore = round4(Math.max(0, Math.min(1, score)));
  const sentimentSignals = (summary.sentimentSignals ?? []).filter(
    (s) => s.segmentIndex >= 0 && s.segmentIndex < n,
  );

  // --- Gap E: fixed taxonomy + freeform tags + highlight ---
  const tagsFixed = uniqLimited(
    (summary.tagsFixed ?? []).filter((t) => Object.prototype.hasOwnProperty.call(VISUAL_TAG_TAXONOMY, t)),
    MAX_FIXED_TAGS,
  );
  const tagsFreeform = uniqLimited(
    (summary.tagsFreeform ?? []).map((t) => t.trim()).filter((t) => FREEFORM_TAG_RE.test(t)),
    MAX_FREEFORM_TAGS,
  );

  return {
    summary: summary.summary,
    sentiment,
    tags,
    keyMoments,
    frustrationScore,
    outcome,
    sentimentSignals,
    tagsFixed,
    tagsFreeform,
    highlighted: summary.highlighted === true,
  };
}

/**
 * Deterministic fallback: build a ConsolidatedSummary without calling an LLM.
 * Used when every segment failed or the injected consolidator throws. The
 * orchestrator runs validateAndClampConsolidatedSummary over this too, so the
 * frustration floors still apply to the derived outcome.
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

  const hasMajor = segments.some((s) => s.issueLevel === "major");
  const hasMinor = segments.some((s) => s.issueLevel === "minor");
  const outcome: NonNullable<ConsolidatedSummary["outcome"]> = hasMajor
    ? "frustrated"
    : hasMinor
      ? "friction"
      : "successful";

  const tagSet = new Set<string>();
  for (const seg of segments) {
    if (seg.issueLevel !== "none") tagSet.add(`issue-${seg.issueLevel}`);
    for (const obs of seg.observations) {
      const word = obs.split(/\s|[，。、,;:!?]/).find((w) => w.length >= 2 && w.length <= 16);
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
    .slice(0, MAX_KEY_MOMENTS);

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
    frustrationScore: 0, // clamp floors this from `outcome` + segment signals
    outcome,
    sentimentSignals: [],
    tagsFixed: [],
    tagsFreeform: [],
    highlighted: false,
  };
}

function inferTone(seg: SegmentLlmOutput): ConsolidatedSummary["sentiment"] {
  if (seg.issueLevel === "major") return "negative";
  if (seg.issueLevel === "minor") return "mixed";
  return "neutral";
}

function sanitize(values: string[], maxCount: number, maxLen: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().slice(0, maxLen);
    if (v.length === 0 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= maxCount) break;
  }
  return out;
}

function uniqLimited(values: string[], maxCount: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= maxCount) break;
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
