/**
 * Tests for `apps/web/lib/assistant/access-control.ts` (REQ-4).
 *
 * Coverage:
 *   - Role-level scope check (positive + negative)
 *   - Resource-level cross-workspace deny
 *   - Resource-level write-private deny (member non-creator)
 *   - Resource-level write-private pass (admin/owner regardless of creator)
 *   - Denial envelope shape (matches ToolResultEnvelope<ToolErrorArtifact>)
 *   - Production message constant (no leak)
 *   - Dev-mode [DEBUG] block (BOTH env conditions required)
 *   - Property tests for the policy invariants
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";

import {
  ROLE_SCOPES,
  WorkspaceRole,
  WorkspaceScope,
  type WorkspaceRoleValue,
  type WorkspaceScopeValue,
} from "@merism/contracts";

import {
  checkWorkspaceAccess,
  isAccessDebugMode,
  GENERIC_DENIAL_MESSAGE,
  type WorkspaceAccessContext,
  type ResourceForAccessCheck,
} from "../access-control";

function makeCtx(overrides: Partial<WorkspaceAccessContext> = {}): WorkspaceAccessContext {
  return {
    workspaceId: "ws_A",
    memberId: "user_alice",
    role: "member",
    traceId: "trace_test",
    ...overrides,
  };
}

function makeResource(overrides: Partial<ResourceForAccessCheck> = {}): ResourceForAccessCheck {
  return {
    workspaceId: "ws_A",
    creatorUserId: "user_alice",
    ...overrides,
  };
}

// Silence the `info` log emitted on every denial (otherwise test output is noisy).
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("checkWorkspaceAccess: role-level scope check", () => {
  it("grants when every required scope is in ROLE_SCOPES[role]", () => {
    const result = checkWorkspaceAccess(makeCtx({ role: "member" }), {
      toolName: "listStudies",
      requiredScopes: ["study:viewer"],
    });
    expect(result).toBeNull();
  });

  it("grants when requiredScopes is empty (meta tool / user-scoped tool)", () => {
    const result = checkWorkspaceAccess(makeCtx({ role: "member" }), {
      toolName: "todoWrite",
      requiredScopes: [],
    });
    expect(result).toBeNull();
  });

  it("denies when a required scope is unknown to the role (forward-compat)", () => {
    // Simulate a future scope the role map does NOT yet cover. Cast through
    // `unknown` because today every WorkspaceScope is in every role.
    const fakeScope = "workspace:settings" as unknown as WorkspaceScopeValue;
    const result = checkWorkspaceAccess(makeCtx({ role: "member" }), {
      toolName: "configureWorkspace",
      requiredScopes: [fakeScope],
    });
    expect(result).not.toBeNull();
    expect(result?.artifact).toEqual({ error: true, message: GENERIC_DENIAL_MESSAGE });
  });

  it("denial envelope has the ToolErrorArtifact shape and is frozen", () => {
    const result = checkWorkspaceAccess(makeCtx(), {
      toolName: "x",
      requiredScopes: ["future:scope" as unknown as WorkspaceScopeValue],
    });
    expect(result).not.toBeNull();
    expect(result?.artifact.error).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.artifact)).toBe(true);
  });
});

describe("checkWorkspaceAccess: resource-level cross-workspace deny", () => {
  it("denies when resource.workspaceId !== ctx.workspaceId, regardless of role", () => {
    for (const role of WorkspaceRole.options) {
      const result = checkWorkspaceAccess(makeCtx({ workspaceId: "ws_A", role }), {
        toolName: "searchInterviewData",
        requiredScopes: ["study:viewer"],
        resource: {
          record: makeResource({ workspaceId: "ws_B" }),
          access: "viewer",
        },
      });
      expect(result, `role=${role} must deny cross-workspace read`).not.toBeNull();
    }
  });

  it("does NOT check resource when record is null (CREATE operations)", () => {
    const result = checkWorkspaceAccess(makeCtx({ role: "member" }), {
      toolName: "createStudyDraft",
      requiredScopes: ["study:editor"],
      resource: { record: null, access: "editor" },
    });
    expect(result).toBeNull();
  });
});

describe("checkWorkspaceAccess: resource-level write-private", () => {
  it("denies a member trying to edit a study they did not create", () => {
    const result = checkWorkspaceAccess(makeCtx({ role: "member", memberId: "user_bob" }), {
      toolName: "updateStudy",
      requiredScopes: ["study:editor"],
      resource: {
        record: makeResource({ creatorUserId: "user_alice" }),
        access: "editor",
      },
    });
    expect(result).not.toBeNull();
  });

  it("allows a member to edit their own resource", () => {
    const result = checkWorkspaceAccess(makeCtx({ role: "member", memberId: "user_alice" }), {
      toolName: "updateStudy",
      requiredScopes: ["study:editor"],
      resource: {
        record: makeResource({ creatorUserId: "user_alice" }),
        access: "editor",
      },
    });
    expect(result).toBeNull();
  });

  it("allows admin and owner to edit any resource in their workspace", () => {
    for (const role of ["admin", "owner"] as const) {
      const result = checkWorkspaceAccess(makeCtx({ role, memberId: "user_alice" }), {
        toolName: "updateStudy",
        requiredScopes: ["study:editor"],
        resource: {
          record: makeResource({ creatorUserId: "user_bob" }),
          access: "editor",
        },
      });
      expect(result, `role=${role} must pass write-private check`).toBeNull();
    }
  });

  it("does NOT check creator for viewer access", () => {
    const result = checkWorkspaceAccess(makeCtx({ role: "member", memberId: "user_alice" }), {
      toolName: "readStudy",
      requiredScopes: ["study:viewer"],
      resource: {
        record: makeResource({ creatorUserId: "user_bob" }),
        access: "viewer",
      },
    });
    expect(result).toBeNull();
  });
});

describe("checkWorkspaceAccess: denial message format (Q1 option B)", () => {
  it("production message is the constant generic copy", () => {
    // Default NODE_ENV in vitest is "test"; without MERISM_DEBUG_PROVIDERS the
    // dev branch must not fire either. Force the prod path via stubEnv.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MERISM_DEBUG_PROVIDERS", "1"); // even with this set, prod hides
    const result = checkWorkspaceAccess(makeCtx(), {
      toolName: "x",
      requiredScopes: ["future:scope" as unknown as WorkspaceScopeValue],
    });
    expect(result?.artifact.message).toBe(GENERIC_DENIAL_MESSAGE);
  });

  it("dev mode appends [DEBUG] block only when BOTH conditions hold", () => {
    vi.stubEnv("MERISM_DEBUG_PROVIDERS", "1");
    // NODE_ENV is "test" by default in vitest → not "production" → dev branch fires.
    const result = checkWorkspaceAccess(makeCtx({ role: "member" }), {
      toolName: "x",
      requiredScopes: ["future:scope" as unknown as WorkspaceScopeValue],
    });
    expect(result?.artifact.message).toContain(GENERIC_DENIAL_MESSAGE);
    expect(result?.artifact.message).toContain("[DEBUG]");
    expect(result?.artifact.message).toContain("reason=scope");
    expect(result?.artifact.message).toContain("role=member");
    expect(result?.artifact.message).toContain("missing=[future:scope]");
  });

  it("env=1 but NODE_ENV=production: NO debug block", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MERISM_DEBUG_PROVIDERS", "1");
    expect(isAccessDebugMode()).toBe(false);
  });

  it("env unset (default): NO debug block even outside production", () => {
    vi.stubEnv("MERISM_DEBUG_PROVIDERS", "");
    expect(isAccessDebugMode()).toBe(false);
  });

  it("env='true' (not the literal '1'): NO debug block (strict literal)", () => {
    vi.stubEnv("MERISM_DEBUG_PROVIDERS", "true");
    expect(isAccessDebugMode()).toBe(false);
  });

  it("DEBUG block includes reason=cross_workspace when cross-workspace deny fires", () => {
    vi.stubEnv("MERISM_DEBUG_PROVIDERS", "1");
    const result = checkWorkspaceAccess(makeCtx({ workspaceId: "ws_A" }), {
      toolName: "x",
      requiredScopes: ["study:viewer"],
      resource: {
        record: makeResource({ workspaceId: "ws_B" }),
        access: "viewer",
      },
    });
    expect(result?.artifact.message).toContain("reason=cross_workspace");
  });

  it("DEBUG block includes reason=not_creator when write-private deny fires", () => {
    vi.stubEnv("MERISM_DEBUG_PROVIDERS", "1");
    const result = checkWorkspaceAccess(makeCtx({ role: "member", memberId: "user_bob" }), {
      toolName: "x",
      requiredScopes: ["study:editor"],
      resource: {
        record: makeResource({ creatorUserId: "user_alice" }),
        access: "editor",
      },
    });
    expect(result?.artifact.message).toContain("reason=not_creator");
  });
});

describe("checkWorkspaceAccess: logging", () => {
  it("emits one morris.tool.access_denied log line per denial", () => {
    const logSpy = vi.spyOn(console, "log");
    checkWorkspaceAccess(makeCtx({ workspaceId: "ws_A" }), {
      toolName: "searchInterviewData",
      requiredScopes: ["study:viewer"],
      resource: {
        record: makeResource({ workspaceId: "ws_B" }),
        access: "viewer",
      },
    });
    const accessDenied = logSpy.mock.calls
      .map((c) => c[0])
      .filter((line): line is string => typeof line === "string")
      .filter((line) => line.includes("morris.tool.access_denied"));
    expect(accessDenied).toHaveLength(1);
    const parsed = JSON.parse(accessDenied[0]) as Record<string, unknown>;
    expect(parsed.scope).toBe("morris.tool.searchInterviewData");
    expect(parsed.reason).toBe("cross_workspace");
    expect(parsed.traceId).toBe("trace_test");
  });

  it("emits NO log when access is granted", () => {
    const logSpy = vi.spyOn(console, "log");
    checkWorkspaceAccess(makeCtx({ role: "member" }), {
      toolName: "listStudies",
      requiredScopes: ["study:viewer"],
    });
    const accessDenied = logSpy.mock.calls
      .map((c) => c[0])
      .filter((line): line is string => typeof line === "string")
      .filter((line) => line.includes("morris.tool.access_denied"));
    expect(accessDenied).toHaveLength(0);
  });
});

describe("checkWorkspaceAccess: property invariants", () => {
  it("property: in Wave A, any role × any single in-enum required scope passes role-level", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WorkspaceRole.options),
        fc.constantFrom(...WorkspaceScope.options),
        (role, scope) => {
          const granted = ROLE_SCOPES[role as WorkspaceRoleValue];
          expect(granted.includes(scope)).toBe(true);
          const result = checkWorkspaceAccess(makeCtx({ role: role as WorkspaceRoleValue }), {
            toolName: "anyTool",
            requiredScopes: [scope],
          });
          expect(result).toBeNull();
        },
      ),
    );
  });

  it("property: any cross-workspace resource denies regardless of role × access", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WorkspaceRole.options),
        fc.constantFrom("viewer" as const, "editor" as const),
        (role, access) => {
          const result = checkWorkspaceAccess(
            makeCtx({ role: role as WorkspaceRoleValue, workspaceId: "ws_A" }),
            {
              toolName: "anyTool",
              requiredScopes: ["study:viewer"],
              resource: {
                record: makeResource({ workspaceId: "ws_B" }),
                access,
              },
            },
          );
          expect(result).not.toBeNull();
        },
      ),
    );
  });

  it("property: editor access × member × non-creator always denies", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s !== "user_alice"),
        (otherCreator) => {
          const result = checkWorkspaceAccess(makeCtx({ role: "member", memberId: "user_alice" }), {
            toolName: "updateStudy",
            requiredScopes: ["study:editor"],
            resource: {
              record: makeResource({ creatorUserId: otherCreator }),
              access: "editor",
            },
          });
          expect(result).not.toBeNull();
        },
      ),
    );
  });

  it("property: editor access × admin|owner × any creator always grants (in-workspace)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("admin" as const, "owner" as const),
        fc.string({ minLength: 1, maxLength: 32 }),
        (role, creator) => {
          const result = checkWorkspaceAccess(makeCtx({ role, memberId: "user_alice" }), {
            toolName: "updateStudy",
            requiredScopes: ["study:editor"],
            resource: {
              record: makeResource({ creatorUserId: creator }),
              access: "editor",
            },
          });
          expect(result).toBeNull();
        },
      ),
    );
  });
});
