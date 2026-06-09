/**
 * ProseMirror JSON → Markdown serializer (Merism subset, zero deps).
 *
 * 反向于 markdown-to-prose.ts. 用途:
 * 1. Morris 在新一份 Notebook 引用之前 Notebook 内容时, 服务端把存储的
 *    ProseMirror JSON 拼回 Markdown 喂给 LLM context (Wave D / E).
 * 2. textContent 字段抽取 (从 PM JSON 抽 plain text 用作 fulltext index +
 *    embedding) — 由 extractTextContent 单独导出。
 *
 * 设计: merism-* atom node 序列化为 self-closing tag 形式
 * `<merism-quote sessionId="..." segmentIndex="5" />`。
 */

import type {
  BlockNode,
  HeadingNode,
  InlineNode,
  MerismNode,
  ParagraphNode,
  ProseMirrorDoc,
  StrippedNode,
} from "./types";

function serializeAttrValue(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  // Escape `"` in string values
  return v.replace(/"/g, "&quot;");
}

function serializeMerismNode(n: MerismNode | StrippedNode): string {
  const parts: string[] = [n.type];
  for (const [k, v] of Object.entries(n.attrs)) {
    parts.push(`${k}="${serializeAttrValue(v)}"`);
  }
  return `<${parts.join(" ")} />`;
}

function serializeInline(content: InlineNode[]): string {
  return content
    .map((n) => {
      if (n.type === "text") return n.text;
      return serializeMerismNode(n);
    })
    .join("");
}

function serializeBlock(b: BlockNode): string {
  if (b.type === "heading") {
    const hashes = "#".repeat(b.attrs.level);
    return `${hashes} ${serializeInline((b as HeadingNode).content)}`;
  }
  if (b.type === "paragraph") {
    return serializeInline((b as ParagraphNode).content);
  }
  // Block-level merism-* atom (rare — usually inline)
  return serializeMerismNode(b);
}

/** Convert a ProseMirror doc back to a Markdown string. */
export function proseMirrorToMarkdown(doc: ProseMirrorDoc): string {
  if (!doc.content || doc.content.length === 0) return "";
  return doc.content.map(serializeBlock).join("\n\n");
}

/**
 * Extract plain text from a ProseMirror doc — used to populate
 * `Notebook.textContent` (fulltext-indexed mirror) and to feed Qwen
 * embedding endpoint. Drops all merism-* atom nodes (they are structural
 * references, not natural-language content; their semantic context is
 * already captured in surrounding paragraphs by the LLM).
 */
export function extractTextContent(doc: ProseMirrorDoc): string {
  if (!doc.content || doc.content.length === 0) return "";
  const parts: string[] = [];
  for (const b of doc.content) {
    if (b.type === "heading" || b.type === "paragraph") {
      const inline = b.content
        .filter((n): n is { type: "text"; text: string } => n.type === "text")
        .map((n) => n.text)
        .join("");
      if (inline.trim()) parts.push(inline);
    }
  }
  return parts.join("\n\n");
}
