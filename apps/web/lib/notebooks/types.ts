/**
 * Notebook ProseMirror JSON shape (Merism subset).
 *
 * 设计决策 (Wave C T17): 不引入 @tiptap/* 或 prosemirror-* runtime 依赖。
 * Notebook 由 Morris AI 创建即只读 (D10), 不需要编辑接口 (slash command /
 * drag handle / 工具栏 / 撤销栈). 因此我们用一个 **ProseMirror-shaped JSON**
 * 自定义类型, 直接 React 树渲染。Markdown↔JSON 转换由 lib/notebooks/
 * markdown-to-prose.ts (Wave C T18) 完成。
 *
 * 结构与上游 ProseMirror node JSON 保持一致 (https://prosemirror.net/docs/ref/
 * #model.Node.toJSON), 字段 type / attrs / content / text 等命名与官方一致 ——
 * 未来若决定接 PostHog 或其他 ProseMirror viewer, 不需重写 schema 数据。
 *
 * 支持的内置 node type (Wave C):
 * - "doc": 顶层文档容器
 * - "heading": attrs.level ∈ {1, 2, 3}, inline content
 * - "paragraph": inline content
 * - "text": leaf, has `text` field
 *
 * 自定义 merism-* atom node (Wave C T22, 内联或块级):
 * - "merism-quote", "merism-video-clip", "merism-theme",
 *   "merism-video-observation", "merism-insight-link", "merism-question-stat",
 *   "merism-cross-study-citation", "merism-session-link"
 *
 * 所有 merism-* node 都是 atom (无 content) inline leaf, attrs 携带其语义字段。
 */

/** Inline text leaf. */
export interface TextNode {
  type: "text";
  text: string;
}

/** Eight Merism custom atom nodes (R3, design §7.2). */
export type MerismNodeType =
  | "merism-quote"
  | "merism-video-clip"
  | "merism-theme"
  | "merism-video-observation"
  | "merism-insight-link"
  | "merism-question-stat"
  | "merism-cross-study-citation"
  | "merism-session-link";

export const MERISM_NODE_TYPES: readonly MerismNodeType[] = [
  "merism-quote",
  "merism-video-clip",
  "merism-theme",
  "merism-video-observation",
  "merism-insight-link",
  "merism-question-stat",
  "merism-cross-study-citation",
  "merism-session-link",
] as const;

/** Merism atom node: no content, just attrs. */
export interface MerismNode {
  type: MerismNodeType;
  attrs: Record<string, string | number | boolean | null>;
}

/**
 * Stripped placeholder produced by `filterNotebookContentForPublishing`. Renders
 * as a generic "[ 共享时已隐去 ]" badge — original PII attrs (sessionId /
 * startMs / notebookShortId 等) are dropped before this node is exposed to a
 * third party. `kind` is the original Merism node type kept only as a layout
 * hint (e.g., to render a different icon for "video stripped" vs "session
 * stripped"). 见 lib/notebooks/filter-for-publishing.ts + D9.
 */
export interface StrippedNode {
  type: "merism-stripped";
  attrs: { kind: string };
}

/** Inline content within a paragraph or heading. */
export type InlineNode = TextNode | MerismNode | StrippedNode;

/** Block-level nodes inside `doc`. */
export interface HeadingNode {
  type: "heading";
  attrs: { level: 1 | 2 | 3 };
  content: InlineNode[];
}

export interface ParagraphNode {
  type: "paragraph";
  content: InlineNode[];
}

export type BlockNode = HeadingNode | ParagraphNode | MerismNode | StrippedNode;

/** Top-level document. */
export interface ProseMirrorDoc {
  type: "doc";
  content: BlockNode[];
}

/** Type guard: is this a Merism custom atom node? */
export function isMerismNode(n: { type: string }): n is MerismNode {
  return MERISM_NODE_TYPES.includes(n.type as MerismNodeType);
}

/** Empty document — used as initial / fallback content. */
export const EMPTY_DOC: ProseMirrorDoc = {
  type: "doc",
  content: [],
};
