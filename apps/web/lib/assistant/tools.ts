/**
 * Morris 工具聚合层。具体工具在 `./tools/*.ts`。
 *
 * `buildAssistantTools(ctx)` 返回扁平的 `Record<toolName, ToolSpec>` 给
 * `ToolLoopAgent` 用 (向后兼容现有 agent.ts 与单测)。
 *
 * `buildToolContextTemplates(ctx)` 返回 `Record<toolName, string | undefined>`
 * 给路由层 system prompt 拼接器用 (R2)。
 *
 * 公共类型 (`AssistantToolContext`) 在 `./tool-types`;
 * 工具结果信封 (`ToolResultEnvelope` / `toolResult` / `toToolError` /
 * `NOT_SIGNED_IN` / `ToolErrorArtifact`) 在 `./envelope`。本文件保留同名 re-export
 * 以兼容既有引用。
 */

import { buildListStudiesTool } from "./tools/list-studies";
import { buildSearchInterviewDataTool } from "./tools/search-interview-data";
import { buildAnalyzeDataTool } from "./tools/analyze-data";
import { buildCreateStudyDraftTool } from "./tools/create-study-draft";
import { buildCreateNotebookTool } from "./tools/create-notebook";
import { buildSearchAcrossStudiesTool } from "./tools/search-across-studies";
import { buildTodoWriteTool, type TodoState } from "./tools/todo-write";
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
 * 当前包含 4 个工具:listStudies / searchInterviewData / analyzeData /
 * createStudyDraft。新增工具按 ./tools/*.ts 同模式落,然后在这里注册即可。
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
  };
}
