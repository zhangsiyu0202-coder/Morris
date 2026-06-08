// Per-segment prompt for Gemini video understanding.
//
// One Gemini call analyzes one segment. The model is given:
//   - The video slice via Files API + start_offset/end_offset (in the request body).
//   - The transcript context for that slice (here, in the prompt).
//   - A strict JSON output spec.
//
// Returns segment-local observations only. Session-level summary,
// sentiment, tags, and ranked keyMoments are produced by the
// consolidation step (DeepSeek), not by Gemini per-segment.

import type { VideoSegmentSpec } from "../video-segments.js";

export const VISUAL_SEGMENT_ANALYSIS_SYSTEM = `你是 Morris 的定性研究视频分析师。你只分析当前请求中给定时间窗内的访谈录像画面。原则:
- 严格基于视频画面与给定 transcript context, 不要编造画面外信息。
- 重点观察: 受访者停顿/犹豫、困惑、情绪变化、注意力转移、对刺激物或界面的反应、明显的操作或阅读行为。
- transcript 仅作为辅助上下文, 视觉判断必须来自画面。
- 不输出 Markdown, 不输出解释性前后缀, 只输出一个 JSON object。`;

export interface SegmentPromptInput {
  segment: VideoSegmentSpec;
  /** Total video duration in ms — helps the model interpret absolute timestamps. */
  totalDurationMs: number;
}

export function buildSegmentPrompt(input: SegmentPromptInput): string {
  const { segment, totalDurationMs } = input;
  const transcriptLines = segment.transcriptRefs
    .map((r) => `[${formatTimestamp(r.startMs)} ${r.speaker}] ${r.text}`)
    .join("\n");

  return [
    `请分析这段访谈录像在 [${formatTimestamp(segment.startMs)} - ${formatTimestamp(segment.endMs)}] 这一时间窗内的视觉行为。`,
    `录像总长 ${formatTimestamp(totalDurationMs)}。当前时间窗在录像中的位置: 起始 ${segment.startMs}ms, 结束 ${segment.endMs}ms。`,
    "",
    "输出严格 JSON, shape:",
    JSON.stringify(
      {
        title: "该段视觉主题, 4-12 个汉字",
        description: "1-2 句对该段画面的观察",
        observations: ["具体视觉观察, 多条"],
        issueLevel: "none | minor | major",
        candidateMoments: [
          {
            timestampMs: 0,
            label: "关键时刻短标题",
            description: "为什么这个画面值得研究员关注",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "约束:",
    `- candidateMoments 中的 timestampMs 必须是录像绝对时间(ms), 且必须落在 [${segment.startMs}, ${segment.endMs}] 范围内。`,
    "- candidateMoments 至多 3 个; 没有值得提的就给空数组。",
    "- 如果看不出明确问题, issueLevel 用 none。",
    "- 全程使用 transcript 主要语言。",
    "",
    transcriptLines.length > 0
      ? `Transcript context for this window (asr 可能不准, 视觉判断优先):\n${transcriptLines}`
      : "(本时间窗内没有 transcript 文本; 完全依靠画面分析。)",
  ].join("\n");
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
