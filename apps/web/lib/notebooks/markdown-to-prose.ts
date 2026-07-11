/**
 * Markdown ↔ ProseMirror JSON converter (Merism subset, zero deps).
 *
 * 支持的 Markdown 子集 (Notebook 主用法):
 * - `#`, `##`, `###` headings (level 1 / 2 / 3)
 * - 段落 (paragraph), 多个连续非空白行折成一段, 空行分段
 * - 内联 `<merism-*>` self-closing 或开闭 tag 解析为 atom node
 *
 * 不支持 (Wave C 不需要 — Morris createNotebook 不会输出这些):
 * - lists / blockquote / code blocks / inline bold-italic-code
 * - 嵌套 (merism-* node 是 atom, 不存在嵌套)
 *
 * 设计决策 (B3 修订项 — 流式半截 tag fallback):
 * 流式生成时 content 可能停在半截 tag 状态 (`<merism-quote sessionId="abc"`
 * 没有闭合 `>` 或 `/>`). markdownToProseMirror 不抛错; 把整段未闭合内容当作
 * plain text 显示, 等闭合 tag 到达后下次 markdownToProseMirror 调用会重新
 * 解析为完整 atom node (流式预览面板增量重渲染整个 content)。
 */

import type {
  BlockNode,
  HeadingNode,
  InlineNode,
  MerismNode,
  ParagraphNode,
  ProseMirrorDoc,
  TextNode,
} from "./types";
import { EMPTY_DOC, MERISM_NODE_TYPES } from "./types";

// `<merism-quote sessionId="abc" segmentIndex="5" />` (self-close)
// `<merism-quote sessionId="abc"></merism-quote>` (open-close form, attrs only on open tag)
const MERISM_TAG_RE = /<merism-([a-z-]+)\b([^>]*?)\/?>(?:<\/merism-\1>)?/g;
// Detect any unclosed `<merism-*` opening at end of string (no `>` ahead).
const MERISM_UNCLOSED_RE = /<merism-[a-z-]*$|<merism-[a-z-]+\b[^>]*$/;

/**
 * Parse `<merism-quote sessionId="abc" segmentIndex="5" />` style attributes.
 * Returns the MerismNode or null if `merism-${name}` is not a known type.
 */
function parseMerismAttrs(name: string, attrsRaw: string): MerismNode | null {
  const fullName = `merism-${name}`;
  if (!(MERISM_NODE_TYPES as readonly string[]).includes(fullName)) return null;
  const attrs: Record<string, string | number | boolean | null> = {};
  // Match key="v" / key='v' / key=v
  const ATTR_RE = /([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrsRaw)) !== null) {
    const k = m[1];
    if (!k) continue;
    const v = m[2] ?? m[3] ?? m[4] ?? "";
    if (/^-?\d+$/.test(v)) attrs[k] = Number.parseInt(v, 10);
    else if (/^-?\d+\.\d+$/.test(v)) attrs[k] = Number.parseFloat(v);
    else if (v === "true") attrs[k] = true;
    else if (v === "false") attrs[k] = false;
    else attrs[k] = v;
  }
  return { type: fullName as MerismNode["type"], attrs };
}

/** Merge consecutive TextNode items. */
function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last && last.type === "text") {
      (last as TextNode).text += n.text;
    } else {
      out.push(n);
    }
  }
  return out;
}

/**
 * Parse a single line of inline content into TextNode + MerismNode array.
 * Unclosed `<merism-*` at the tail is preserved as plain text (B3 fallback).
 */
function parseInlineLine(line: string): InlineNode[] {
  const out: InlineNode[] = [];
  let cursor = 0;
  MERISM_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MERISM_TAG_RE.exec(line)) !== null) {
    if (match.index > cursor) {
      const text = line.slice(cursor, match.index);
      if (text.length > 0) out.push({ type: "text", text });
    }
    const node = parseMerismAttrs(match[1] ?? "", match[2] ?? "");
    if (node) {
      out.push(node);
    } else {
      // Unknown merism-foo: preserve as plain text
      out.push({ type: "text", text: match[0] });
    }
    cursor = MERISM_TAG_RE.lastIndex;
  }
  if (cursor < line.length) {
    out.push({ type: "text", text: line.slice(cursor) });
  }
  return mergeAdjacentText(out);
}

/**
 * Convert a Markdown string to a ProseMirror-shaped JSON document.
 *
 * Robust to streaming: never throws. If the trailing region contains an
 * unclosed `<merism-*` opening tag, the unclosed tail is rendered as
 * plain text; a subsequent call with the closing tag will parse the full
 * atom node.
 */
export function markdownToProseMirror(markdown: string): ProseMirrorDoc {
  if (!markdown) return EMPTY_DOC;
  const text = markdown.replace(/\r\n?/g, "\n");
  const rawBlocks = text.split(/\n{2,}/);
  const blocks: BlockNode[] = [];
  for (const rawBlock of rawBlocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    // Single-line heading
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(block);
    if (headingMatch && !block.includes("\n")) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      blocks.push({
        type: "heading",
        attrs: { level },
        content: parseInlineLine(headingMatch[2] ?? ""),
      } satisfies HeadingNode);
      continue;
    }
    // Paragraph: collapse interior \n into spaces (Markdown convention)
    const joined = block.replace(/\n+/g, " ");
    const inline = parseInlineLine(joined);
    if (inline.length > 0) {
      blocks.push({ type: "paragraph", content: inline } satisfies ParagraphNode);
    }
  }
  return { type: "doc", content: blocks };
}

/**
 * Streaming hint: does this Markdown contain an unclosed `<merism-*` opening
 * tag at its tail? Useful for streaming UIs that want a "still typing"
 * affordance distinct from the regular fallback rendering.
 */
export function hasUnclosedMerismTag(markdown: string): boolean {
  return MERISM_UNCLOSED_RE.test(markdown);
}
