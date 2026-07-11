/**
 * Morris 工具聚合层。具体工具在 `./tools/*.ts`。
 *
 * `buildAssistantTools(ctx)` 返回扁平的 `Record<toolName, ToolSpec>` 给
 * `ToolLoopAgent` 用。每个工具自己用 AI SDK 6 原生 `tool({ needsApproval, execute })`
 * 表达 destructive 语义,不再有自写的 `withApprovalGuard` 套壳 (per AI SDK 6
 * 原生 HITL flow, 参 https://ai-sdk.dev/cookbook/next/human-in-the-loop)。
 *
 * `buildToolContextTemplates(ctx)` 返回 `Record<toolName, string | undefined>`
 * 给路由层 system prompt 拼接器用 (R2)。
 *
 * 公共类型 (`AssistantToolContext`) 在 `./tool-types`;
 * 工具结果信封 (`ToolResultEnvelope` / `toolResult` / `toToolError` /
 * `NOT_SIGNED_IN` / `ToolErrorArtifact`) 在 `./envelope`。
 */

import { buildListStudiesTool } from "./tools/list-studies";
import { buildSearchInterviewDataTool } from "./tools/search-interview-data";
import { buildAnalyzeDataTool } from "./tools/analyze-data";
import { buildCreateStudyDraftTool } from "./tools/create-study-draft";
import { buildCreateNotebookTool } from "./tools/create-notebook";
import { buildSearchAcrossStudiesTool } from "./tools/search-across-studies";
import { buildTodoWriteTool, type TodoState } from "./tools/todo-write";
import { buildManageMemoriesTool } from "./tools/manage-memories";
import type { TodoItem } from "./system-prompt";

export type { AssistantToolContext } from "./tool-types";
export {
  toolResult,
  toToolError,
  NOT_SIGNED_IN,
  isToolError,
  type ToolErrorArtifact,
  type ToolResultEnvelope,
} from "./envelope";

import type { AssistantToolContext } from "./tool-types";
import type { ToolMetadata } from "./tool-metadata";

/** 工具集的扩展 ctx: 把 TodoWrite 元工具需要的状态通道挂在这里, 不污染 AssistantToolContext。 */
export interface AssistantToolsCtx extends AssistantToolContext {
  /** 缺省 → 内部建一个临时空 store (只在测试 / 未接 PageContextProvider 时走到)。 */
  todoState?: TodoState;
}

function makeDefaultTodoState(): TodoState {
  let todos: TodoItem[] = [];
  return {
    get: () => todos,
    set: (next) => {
      todos = next;
    },
  };
}

/**
 * 构造 Morris 的工具集合。返回扁平 record 直接喂给 ToolLoopAgent。
 *
 * 8 个工具: listStudies / searchInterviewData / analyzeData / createStudyDraft /
 * createNotebook / searchAcrossStudies / todoWrite / manageMemories。
 *
 * Approval 语义: 由每个工具自己在 `tool({ needsApproval: ... })` 处声明 (AI SDK 6
 * 原生)。当前 destructive 工具:
 *   - `createStudyDraft`: needsApproval 在登录态时 true (未登录走 preview 不写库)。
 *   - `manageMemories.delete`: per-action 动态 needsApproval — `action === "delete"`
 *     时触发研究员二次确认; 其余 action (create/query/update/list) 直接执行。
 * 参 docs/adr/0009-aisdk-native-hitl-and-prune-messages.md。
 */
export function buildAssistantTools(ctx: AssistantToolsCtx) {
  const todoState = ctx.todoState ?? makeDefaultTodoState();
  return {
    listStudies: buildListStudiesTool(ctx).spec,
    searchInterviewData: buildSearchInterviewDataTool(ctx).spec,
    analyzeData: buildAnalyzeDataTool(ctx).spec,
    createStudyDraft: buildCreateStudyDraftTool(ctx).spec,
    createNotebook: buildCreateNotebookTool(ctx).spec,
    searchAcrossStudies: buildSearchAcrossStudiesTool(ctx).spec,
    todoWrite: buildTodoWriteTool({ todoState }).spec,
    manageMemories: buildManageMemoriesTool(ctx).spec,
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;

/**
 * 取出每个工具声明的 contextPromptTemplate,供路由层 system prompt 拼接器
 * (Wave D) 渲染 `<tool_context>` 段。返回的 record key 一定与
 * `buildAssistantTools(ctx)` 的 key 一致。
 *
 * 没声明模板的工具映射为 `undefined`(整段省略),不写空字符串。
 */
export function buildToolContextTemplates(
  ctx: AssistantToolContext,
): Record<keyof AssistantTools, string | undefined> {
  return {
    listStudies: buildListStudiesTool(ctx).contextPromptTemplate,
    searchInterviewData: buildSearchInterviewDataTool(ctx).contextPromptTemplate,
    analyzeData: buildAnalyzeDataTool(ctx).contextPromptTemplate,
    createStudyDraft: buildCreateStudyDraftTool(ctx).contextPromptTemplate,
    createNotebook: buildCreateNotebookTool(ctx).contextPromptTemplate,
    searchAcrossStudies: buildSearchAcrossStudiesTool(ctx).contextPromptTemplate,
    todoWrite: undefined,
    manageMemories: buildManageMemoriesTool(ctx).contextPromptTemplate,
  };
}


/**
 * 构造 Morris 工具的元数据 manifest 视图 (R6 / morris-tool-metadata).
 *
 * 返回的 record keys 与 `buildAssistantTools(ctx)` 一致 — `metadata.test.ts::K-METADATA-01`
 * 强制这点。给 system-prompt TOOLS_OVERVIEW / tool-results UI 共用。
 *
 * `todoWrite` 的 builder 需要 `todoState` 参数, 但 metadata 与 todoState 无关, 这里给一个空 stub。
 *
 * 性能: O(N=8) 纯函数, 每请求调一次 < 1ms。禁止跨请求缓存 — builder 是请求作用域。
 */
export function buildAssistantToolMetadata(
  ctx: AssistantToolContext,
): Record<keyof AssistantTools, ToolMetadata> {
  const todoStateStub = { get: () => [], set: () => {} };
  return {
    listStudies: buildListStudiesTool(ctx).metadata,
    searchInterviewData: buildSearchInterviewDataTool(ctx).metadata,
    analyzeData: buildAnalyzeDataTool(ctx).metadata,
    createStudyDraft: buildCreateStudyDraftTool(ctx).metadata,
    createNotebook: buildCreateNotebookTool(ctx).metadata,
    searchAcrossStudies: buildSearchAcrossStudiesTool(ctx).metadata,
    todoWrite: buildTodoWriteTool({ todoState: todoStateStub }).metadata,
    manageMemories: buildManageMemoriesTool(ctx).metadata,
  };
}
