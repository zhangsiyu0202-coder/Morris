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
import { withApprovalGuard } from "./approval";

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
/**
 * 把 builder 输出的 spec.execute 用 withApprovalGuard 包装 (R4 / morris-tool-metadata).
 * destructive=false 时是 identity wrapper, 零开销; destructive=true 时无 approvalToken
 * 走 proposeApproval 路径让 hasPendingApproval 终止。
 *
 * `execute` 强转 any 是因为 Vercel AI SDK 6 的 tool().execute 用 generic narrow
 * 出每个工具自己的 input/output 形状, withApprovalGuard 用统一 generic 不能直接
 * 命中。当前 7 工具全 destructive=false 走 identity 分支, 运行时等价于原 execute,
 * 不会引入类型不匹配的实际风险。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpec = any;
function wrapWithApproval<
  T extends { spec: AnySpec; metadata: ToolMetadata; approvalPreview?: (input: never) => string },
>(name: string, built: T): T["spec"] {
  const guarded = withApprovalGuard(
    name,
    built.metadata,
    built.spec.execute as never,
    built.approvalPreview as never,
  );
  return { ...built.spec, execute: guarded } as T["spec"];
}

export function buildAssistantTools(ctx: AssistantToolsCtx) {
  const todoState = ctx.todoState ?? makeDefaultTodoState();
  const builds = {
    listStudies: buildListStudiesTool(ctx),
    searchInterviewData: buildSearchInterviewDataTool(ctx),
    analyzeData: buildAnalyzeDataTool(ctx),
    createStudyDraft: buildCreateStudyDraftTool(ctx),
    createNotebook: buildCreateNotebookTool(ctx),
    searchAcrossStudies: buildSearchAcrossStudiesTool(ctx),
    todoWrite: buildTodoWriteTool({ todoState }),
    manageMemories: buildManageMemoriesTool(ctx),
  };
  return {
    listStudies: wrapWithApproval("listStudies", builds.listStudies),
    searchInterviewData: wrapWithApproval("searchInterviewData", builds.searchInterviewData),
    analyzeData: wrapWithApproval("analyzeData", builds.analyzeData),
    createStudyDraft: wrapWithApproval("createStudyDraft", builds.createStudyDraft),
    createNotebook: wrapWithApproval("createNotebook", builds.createNotebook),
    searchAcrossStudies: wrapWithApproval("searchAcrossStudies", builds.searchAcrossStudies),
    todoWrite: wrapWithApproval("todoWrite", builds.todoWrite),
    manageMemories: wrapWithApproval("manageMemories", builds.manageMemories),
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
 * 强制这点。给 approval guard / system-prompt TOOLS_OVERVIEW / tool-results UI 共用。
 *
 * `todoWrite` 的 builder 需要 `todoState` 参数, 但 metadata 与 todoState 无关, 这里给一个空 stub。
 *
 * 性能: O(N=7) 纯函数, 每请求调一次 < 1ms。禁止跨请求缓存 — builder 是请求作用域。
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
