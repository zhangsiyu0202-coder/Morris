"use client";

import Link from "next/link";
import {
  Quote,
  Film,
  Tag,
  Eye,
  Lightbulb,
  BarChart2,
  Link as LinkIcon,
  Mic,
  Lock,
} from "lucide-react";
import type { MerismNode, StrippedNode } from "@/lib/notebooks/types";

/**
 * 8 类 merism-* atom node 的 React 渲染。每个组件:
 * - 渲染一张紧凑卡片(font-data, 中性 mauve 色调)
 * - 接受 attrs 显示语义字段(sessionId / segmentIndex / quote 等)
 * - 含点击跳转: quote → /studies/[studyId]/results/[sessionId]#segment=N;
 *   video-clip → /studies/[studyId]/results/[sessionId]?t=startMs; theme →
 *   /studies/[studyId]/dashboard?theme=themeId; insight-link / cross-study
 *   citation → /notebooks/[shortId]; session-link → 同 video-clip 但定位整段。
 *
 * 设计 (D10): 这些渲染只读, 不引入编辑接口。Document view 与 publish view
 * 都用同一个 renderer (publish view 由 filter-for-publishing.ts 把不在 allowlist
 * 的 atom 替换为 merism-stripped, 走最后一个 case)。
 */

const CARD_BASE =
  "inline-flex items-baseline gap-1.5 rounded-sm bg-mauve-50 px-2 py-1 font-data text-caption text-ink-700 align-baseline border border-mauve-200/60 hover:bg-mauve-100";

function attrStr(node: MerismNode, key: string, fallback = ""): string {
  const v = node.attrs[key];
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function attrNum(node: MerismNode, key: string): number | null {
  const v = node.attrs[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

/** Fallback when the node type is unknown or stripped — shows a generic placeholder. */
function StrippedCard({ kind }: { kind?: string }) {
  return (
    <span className={CARD_BASE} role="img" aria-label={`隐去的引用 (${kind ?? ""})`}>
      <Lock size={12} aria-hidden /> 共享时已隐去
    </span>
  );
}

function MerismQuote({ node }: { node: MerismNode }) {
  const quote = attrStr(node, "quote");
  const sessionId = attrStr(node, "sessionId");
  const segmentIndex = attrNum(node, "segmentIndex");
  const studyId = attrStr(node, "studyId");
  const href = studyId && sessionId
    ? `/studies/${studyId}/results/${sessionId}${segmentIndex !== null ? `#segment=${segmentIndex}` : ""}`
    : null;
  const inner = (
    <>
      <Quote size={12} aria-hidden />
      <span className="line-clamp-1">"{quote}"</span>
    </>
  );
  return href ? (
    <Link href={href} className={CARD_BASE}>
      {inner}
    </Link>
  ) : (
    <span className={CARD_BASE}>{inner}</span>
  );
}

function MerismVideoClip({ node }: { node: MerismNode }) {
  const sessionId = attrStr(node, "sessionId");
  const startMs = attrNum(node, "startMs") ?? 0;
  const endMs = attrNum(node, "endMs") ?? 0;
  const studyId = attrStr(node, "studyId");
  const href = studyId && sessionId
    ? `/studies/${studyId}/results/${sessionId}?t=${Math.floor(startMs / 1000)}`
    : null;
  const dur = `${Math.floor(startMs / 1000)}s–${Math.floor(endMs / 1000)}s`;
  const inner = (
    <>
      <Film size={12} aria-hidden />
      <span>视频片段 · {dur}</span>
    </>
  );
  return href ? (
    <Link href={href} className={CARD_BASE}>
      {inner}
    </Link>
  ) : (
    <span className={CARD_BASE}>{inner}</span>
  );
}

function MerismTheme({ node }: { node: MerismNode }) {
  const themeId = attrStr(node, "themeId");
  const mentions = attrNum(node, "mentions");
  const pct = attrNum(node, "pct");
  return (
    <span className={CARD_BASE}>
      <Tag size={12} aria-hidden />
      <span>主题 · {themeId}</span>
      {mentions !== null ? <span className="text-ink-500">({mentions} 次)</span> : null}
      {pct !== null ? <span className="text-ink-500">{pct}%</span> : null}
    </span>
  );
}

function MerismVideoObservation({ node }: { node: MerismNode }) {
  const note = attrStr(node, "note");
  const startMs = attrNum(node, "startMs") ?? 0;
  return (
    <span className={CARD_BASE}>
      <Eye size={12} aria-hidden />
      <span>视觉观察 · {Math.floor(startMs / 1000)}s</span>
      {note ? <span className="text-ink-500">{note}</span> : null}
    </span>
  );
}

function MerismInsightLink({ node }: { node: MerismNode }) {
  const shortId = attrStr(node, "notebookShortId");
  return (
    <Link href={`/notebooks/${shortId}`} className={CARD_BASE}>
      <Lightbulb size={12} aria-hidden />
      <span>引用 notebook</span>
    </Link>
  );
}

function MerismQuestionStat({ node }: { node: MerismNode }) {
  const questionId = attrStr(node, "questionId");
  const mentions = attrNum(node, "mentions");
  return (
    <span className={CARD_BASE}>
      <BarChart2 size={12} aria-hidden />
      <span>问题统计 · {questionId}</span>
      {mentions !== null ? <span className="text-ink-500">({mentions} 次)</span> : null}
    </span>
  );
}

function MerismCrossStudyCitation({ node }: { node: MerismNode }) {
  const shortId = attrStr(node, "sourceNotebookShortId");
  const headline = attrStr(node, "headline");
  return (
    <Link href={`/notebooks/${shortId}`} className={CARD_BASE}>
      <LinkIcon size={12} aria-hidden />
      <span className="line-clamp-1">跨 study 引用:{headline}</span>
    </Link>
  );
}

function MerismSessionLink({ node }: { node: MerismNode }) {
  const sessionId = attrStr(node, "sessionId");
  const studyId = attrStr(node, "studyId");
  const label = attrStr(node, "label", `会话 ${sessionId}`);
  const href = studyId && sessionId
    ? `/studies/${studyId}/results/${sessionId}`
    : null;
  const inner = (
    <>
      <Mic size={12} aria-hidden />
      <span>{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className={CARD_BASE}>
      {inner}
    </Link>
  ) : (
    <span className={CARD_BASE}>{inner}</span>
  );
}

/** Dispatcher — looks up the renderer by node.type. */
export function MerismNodeRenderer({ node }: { node: MerismNode | StrippedNode }) {
  switch (node.type) {
    case "merism-quote":
      return <MerismQuote node={node} />;
    case "merism-video-clip":
      return <MerismVideoClip node={node} />;
    case "merism-theme":
      return <MerismTheme node={node} />;
    case "merism-video-observation":
      return <MerismVideoObservation node={node} />;
    case "merism-insight-link":
      return <MerismInsightLink node={node} />;
    case "merism-question-stat":
      return <MerismQuestionStat node={node} />;
    case "merism-cross-study-citation":
      return <MerismCrossStudyCitation node={node} />;
    case "merism-session-link":
      return <MerismSessionLink node={node} />;
    case "merism-stripped":
      return <StrippedCard kind={node.attrs.kind} />;
    default:
      return <StrippedCard />;
  }
}
