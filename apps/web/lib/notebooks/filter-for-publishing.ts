/**
 * Notebook content filter for publishing — strips PII / 内部引用 atom nodes
 * before exposing a Notebook to a third party via publish token.
 *
 * 借鉴 PostHog `filter_notebook_content_for_sharing`:
 * https://github.com/PostHog/posthog/blob/master/products/notebooks/backend/util.py
 *
 * D9 决策:
 * - PUBLISHED_ALLOWLIST (默认): merism-quote / merism-theme / merism-question-stat
 *   / merism-cross-study-citation 保留。这些是 业务洞察, 不直接暴露 sessionId
 *   / 录像位置 / 内部 notebook 引用 (cross-study-citation 暴露的是 headline +
 *   shortId, 第三方拿到 shortId 也无法访问对应内部 notebook 因 visibility 仍
 *   是 internal)。
 * - 剥到只剩 type 的: merism-video-clip / merism-session-link /
 *   merism-video-observation / merism-insight-link。这些含 sessionId / 录像
 *   时间戳 / 内部 notebook 引用 — 第三方不应看到具体定位信息。
 * - paragraph / heading / text 不动。
 *
 * P-NB-03 (Wave F PBT) 锁定:
 * - 闭包: 任何 input doc, filter 后输出仍是合法 ProseMirrorDoc, 任何 atom
 *   node type 要么在 allowlist 内 (保留 attrs) 要么是 `merism-stripped` (无 attrs)
 * - 幂等: filter(filter(doc)) === filter(doc)
 */

import type {
  BlockNode,
  InlineNode,
  MerismNode,
  MerismNodeType,
  ParagraphNode,
  ProseMirrorDoc,
  StrippedNode,
} from "./types";

/**
 * Default allow-list for publish-mode rendering. See D9.
 * Merism nodes NOT in this list get replaced by a placeholder atom
 * `{ type: "merism-stripped", attrs: { kind } }` (no PII attrs).
 */
export const PUBLISHED_ALLOWLIST: readonly MerismNodeType[] = [
  "merism-quote",
  "merism-theme",
  "merism-question-stat",
  "merism-cross-study-citation",
] as const;

function filterMerismNode(
  n: MerismNode | StrippedNode,
  allowlist: readonly string[],
): MerismNode | StrippedNode {
  // Already-stripped nodes are passed through verbatim — guarantees
  // idempotence (P-NB-03): filter(filter(doc)) === filter(doc).
  if (n.type === "merism-stripped") return n;
  if (allowlist.includes(n.type)) return n;
  return { type: "merism-stripped", attrs: { kind: n.type } };
}

function filterInline(
  content: InlineNode[] | undefined,
  allowlist: readonly string[],
): InlineNode[] {
  if (!content) return [];
  return content.map((n) => {
    if (n.type === "text") return n;
    return filterMerismNode(n, allowlist);
  });
}

function filterBlock(
  b: BlockNode,
  allowlist: readonly string[],
): BlockNode {
  if (b.type === "heading" || b.type === "paragraph") {
    return {
      ...b,
      content: filterInline((b as ParagraphNode).content, allowlist),
    } as BlockNode;
  }
  // Block-level atom (Merism or already-stripped)
  return filterMerismNode(b, allowlist);
}

/**
 * Strip PII / 内部引用 from a Notebook's ProseMirror content for safe public
 * publishing. Returns a new doc; does not mutate input.
 */
export function filterNotebookContentForPublishing(
  doc: ProseMirrorDoc,
  allowlist: readonly string[] = PUBLISHED_ALLOWLIST,
): ProseMirrorDoc {
  if (!doc?.content) return { type: "doc", content: [] };
  return {
    type: "doc",
    content: doc.content.map((b) => filterBlock(b, allowlist)),
  };
}
