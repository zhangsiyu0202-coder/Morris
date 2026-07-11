import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  buildSystemPrompt,
  type TodoItem,
  type ToolContextEntry,
} from "../../../apps/web/lib/assistant/system-prompt";
import type { PageContext } from "../../../apps/web/lib/assistant/page-context";

/**
 * P-AI-02 — Prompt 段顺序不变量
 *
 * 对任意 todos × pageContext × toolContexts:
 * 1. 静态段顺序固定: agent_info → tools_overview → workstyle → style → error_protocol。
 * 2. 缺省段不出现空标签。
 * 3. 动态段 (current_todo / page_context / tool_context) 一定排在最后一个静态段
 *    `</error_protocol>` 之后。
 */

const todoArb: fc.Arbitrary<TodoItem> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 16 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  status: fc.constantFrom<TodoItem["status"]>("pending", "in_progress", "done"),
});

const pageContextArb: fc.Arbitrary<PageContext> = fc.record(
  {
    path: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
    surveyId: fc.option(fc.string({ minLength: 1, maxLength: 16 }), { nil: undefined }),
    sessionId: fc.option(fc.string({ minLength: 1, maxLength: 16 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

const toolEntryArb: fc.Arbitrary<ToolContextEntry> = fc.record({
  toolName: fc.constantFrom("listStudies", "searchInterviewData", "analyzeData", "createStudyDraft"),
  rendered: fc.string({ minLength: 0, maxLength: 30 }),
});

const STATIC_TAGS = ["<agent_info>", "<tools_overview>", "<workstyle>", "<style>", "<error_protocol>"];

describe("P-AI-02: system prompt section order is invariant", () => {
  it("static tags always appear in the canonical order", () => {
    fc.assert(
      fc.property(fc.array(todoArb, { maxLength: 5 }), pageContextArb, fc.array(toolEntryArb, { maxLength: 5 }), (todos, pageContext, toolContexts) => {
        const out = buildSystemPrompt({ todos, pageContext, toolContexts });
        let last = -1;
        for (const tag of STATIC_TAGS) {
          const idx = out.indexOf(tag);
          expect(idx).toBeGreaterThan(last);
          last = idx;
        }
      }),
    );
  });

  it("never emits empty <current_todo> / <page_context> / <tool_context> tags", () => {
    fc.assert(
      fc.property(fc.array(todoArb, { maxLength: 5 }), pageContextArb, fc.array(toolEntryArb, { maxLength: 5 }), (todos, pageContext, toolContexts) => {
        const out = buildSystemPrompt({ todos, pageContext, toolContexts });
        expect(out).not.toContain("<current_todo>\n\n</current_todo>");
        expect(out).not.toContain("<page_context>\n\n</page_context>");
        expect(out).not.toContain("<tool_context>\n\n</tool_context>");
      }),
    );
  });

  it("dynamic sections (when present) always come after </error_protocol>", () => {
    fc.assert(
      fc.property(fc.array(todoArb, { maxLength: 5 }), pageContextArb, fc.array(toolEntryArb, { maxLength: 5 }), (todos, pageContext, toolContexts) => {
        const out = buildSystemPrompt({ todos, pageContext, toolContexts });
        const staticEnd = out.indexOf("</error_protocol>");
        for (const tag of ["<current_todo>", "<page_context>", "<tool_context>"]) {
          const idx = out.indexOf(tag);
          if (idx !== -1) {
            expect(idx).toBeGreaterThan(staticEnd);
          }
        }
      }),
    );
  });
});
