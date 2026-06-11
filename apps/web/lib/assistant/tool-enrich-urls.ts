/**
 * Client-safe 视图: toolName -> enrichUrl 模板 (Wave E T21 / morris-tool-metadata R5).
 *
 * `buildAssistantToolMetadata(ctx)` 是 server-only (经由 builders 链到 @/lib/queries),
 * 不能直接被 client component 调用。`tool-results.tsx` 与 `conversation.tsx` 在客户端
 * 渲染工具结果时, 通过本文件取每个工具的 enrichUrl 模板.
 *
 * ⚠ 必须与 `buildAssistantToolMetadata(ctx)` 输出的 enrichUrl 字段保持一致。
 * `metadata.test.ts::K-METADATA-09` 强制比对 — 任何漂移都会立即失败。
 *
 * 维护规则: 在 `tools/<name>.ts` 改 metadata.enrichUrl 时, 同步改本文件;
 * 反之亦然。漂移在 review 时也容易看出 (相邻两文件)。
 */

export const TOOL_ENRICH_URLS: Readonly<Record<string, string | undefined>> = {
  listStudies: undefined,
  searchInterviewData: undefined,
  analyzeData: "/reports/{surveyId}",
  createStudyDraft: undefined,
  createNotebook: "/notebooks/{notebookShortId}",
  searchAcrossStudies: undefined,
  todoWrite: undefined,
  manageMemories: undefined,
};
