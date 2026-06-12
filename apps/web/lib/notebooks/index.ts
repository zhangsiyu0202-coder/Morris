/**
 * `@/lib/notebooks` 入口。
 *
 * 历史背景: 之前同时有 `lib/notebooks.ts`(顶层文件)和 `lib/notebooks/`(子目录)
 * 两个 notebooks 实体, 主题不同但同名 — 造成视觉混乱 + Node 模块解析潜在歧义.
 * 已合并: 顶层 .ts 内容移到 `notebooks/study-context.ts`, 此处 re-export 让现有
 * `import "@/lib/notebooks"` 路径继续工作.
 *
 * 子目录其他文件按子文件路径直接 import (`@/lib/notebooks/types` 等).
 */

export {
  notebookReportSchema,
  type NotebookReport,
  listStudyOptions,
  isValidStudyId,
  buildStudyContext,
} from "./study-context";
