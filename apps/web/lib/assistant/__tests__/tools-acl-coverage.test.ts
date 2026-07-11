/**
 * Coverage guard (robustness-hardening REQ-4 Task 1.8): every Morris tool
 * source file must wire `checkWorkspaceAccess` at the top of its `execute`,
 * unless it is on the explicit meta-tool exemption list below.
 *
 * The test reads tool files as text and greps for the import + call. This is
 * weaker than a full execute-with-mock test but catches the most common
 * failure mode — a new tool added without the gate wiring. The unit and
 * property tests in `access-control.test.ts` already cover the gate logic
 * itself.
 *
 * When adding a new tool:
 *   1. Wire `checkWorkspaceAccess` in its execute, OR
 *   2. Add it to `META_TOOLS_EXEMPT_FROM_WORKSPACE_ACL` below with a comment
 *      explaining why (must be user-scoped UI state, not workspace data).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TOOLS_DIR = join(__dirname, "..", "tools");

/**
 * Tools that legitimately don't need a workspace ACL check. Must be
 * `type: "meta"` per `tool-metadata.ts` (UI-only state, no Appwrite write,
 * no workspace data read).
 */
const META_TOOLS_EXEMPT_FROM_WORKSPACE_ACL = new Set([
  "todo-write.ts", // UI todo list — purely client-state, no backend touch
]);

describe("Morris tool workspace ACL coverage", () => {
  const toolFiles = readdirSync(TOOLS_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it("discovers tool files", () => {
    expect(toolFiles.length).toBeGreaterThan(0);
  });

  for (const file of toolFiles) {
    if (META_TOOLS_EXEMPT_FROM_WORKSPACE_ACL.has(file)) {
      it(`${file} is explicitly exempt from workspace ACL (meta tool)`, () => {
        const source = readFileSync(join(TOOLS_DIR, file), "utf8");
        // Meta tools MUST NOT import checkWorkspaceAccess — otherwise the
        // exemption is meaningless. (Counter-check: forces the exemption list
        // to mean what it says.)
        expect(source).not.toContain("checkWorkspaceAccess");
      });
      continue;
    }

    it(`${file} imports checkWorkspaceAccess from access-control`, () => {
      const source = readFileSync(join(TOOLS_DIR, file), "utf8");
      expect(source).toContain('from "../access-control"');
      expect(source).toContain("checkWorkspaceAccess");
    });

    it(`${file} calls checkWorkspaceAccess inside execute`, () => {
      const source = readFileSync(join(TOOLS_DIR, file), "utf8");
      // The call site pattern is `checkWorkspaceAccess(ctx.workspace, {` —
      // assert this exact prefix so a stray import without a call still
      // fails the test.
      expect(source).toContain("checkWorkspaceAccess(ctx.workspace");
    });

    it(`${file} declares typed requiredScopes in metadata`, () => {
      const source = readFileSync(join(TOOLS_DIR, file), "utf8");
      // Every non-meta tool's metadata block contains `requiredScopes:` with
      // at least one WorkspaceScope value (study:* / notebook:* / analysis:* /
      // memory:*). Allow [] only for explicit edge cases (none today for
      // non-meta tools, but the rule keeps options open).
      const hasRequiredScopes = /requiredScopes:\s*\[/.test(source);
      expect(hasRequiredScopes).toBe(true);
    });
  }
});
