import { describe, it, expect } from "vitest";

import { buildTodoWriteTool, type TodoState } from "../tools/todo-write";
import type { TodoItem } from "../system-prompt";
import { buildSystemPrompt } from "../system-prompt";

function makeStore(): TodoState {
  let todos: TodoItem[] = [];
  return {
    get: () => todos,
    set: (next) => {
      todos = next;
    },
  };
}

describe("todoWrite tool", () => {
  it("整体覆盖 todos 并通过 todoState 写入", async () => {
    const todoState = makeStore();
    const tool = buildTodoWriteTool({ todoState }).spec;
    const result: any = await (tool as any).execute({
      todos: [
        { id: "t1", title: "读 listStudies", status: "done" },
        { id: "t2", title: "拉 analyzeData", status: "in_progress" },
      ],
    });
    expect(result.artifact.todos).toHaveLength(2);
    expect(todoState.get()).toEqual([
      { id: "t1", title: "读 listStudies", status: "done" },
      { id: "t2", title: "拉 analyzeData", status: "in_progress" },
    ]);
    expect(result.content).toContain("已更新 todo (2 项)");
  });

  it("第二次调用整体替换前次状态", async () => {
    const todoState = makeStore();
    const tool = buildTodoWriteTool({ todoState }).spec;
    await (tool as any).execute({ todos: [{ id: "a", title: "A", status: "pending" }] });
    await (tool as any).execute({ todos: [{ id: "b", title: "B", status: "in_progress" }] });
    expect(todoState.get()).toEqual([{ id: "b", title: "B", status: "in_progress" }]);
  });

  it("写入后再走 buildSystemPrompt 时, <current_todo> 段含最新条目", async () => {
    const todoState = makeStore();
    const tool = buildTodoWriteTool({ todoState }).spec;
    await (tool as any).execute({
      todos: [{ id: "x", title: "对比三个调研", status: "in_progress" }],
    });
    const prompt = buildSystemPrompt({ todos: todoState.get() });
    expect(prompt).toContain("<current_todo>");
    expect(prompt).toContain("- [in_progress] 对比三个调研");
  });

  it("空 todos 时 system prompt 不渲染 <current_todo>", () => {
    const todoState = makeStore();
    const prompt = buildSystemPrompt({ todos: todoState.get() });
    expect(prompt).not.toContain("<current_todo>");
  });
});
