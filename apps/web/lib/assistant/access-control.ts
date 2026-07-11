/**
 * Morris tool workspace access control (REQ-4 / robustness-hardening).
 *
 * Single-call imperative gate used by Morris tools to enforce workspace-level
 * authorization. Returns `null` on grant (caller proceeds) or a frozen
 * `ToolResultEnvelope<ToolErrorArtifact>` on deny (caller `return`s it).
 *
 * Two-layer policy (matching `.kiro/specs/robustness-hardening/design.md`):
 *   1. Role-level — does `ROLE_SCOPES[ctx.role]` cover every required scope?
 *      Wave A: all three roles grant every scope, so this is currently always
 *      pass for in-workspace requests. The layer exists so future role-
 *      differentiated scopes (`workspace:settings`, `billing:edit`) plug in
 *      without rewriting callers.
 *   2. Resource-level (when caller supplies `resource.record`):
 *      a. cross-workspace deny — `record.workspaceId` must equal
 *         `ctx.workspaceId`, regardless of role. This is the only hard
 *         tenancy gate at the tool layer.
 *      b. editor-on-someone-else deny — for `access: "editor"`, the actor
 *         must be the resource creator OR an admin/owner. This is the
 *         ADR-0006 D3 "write-private" half (member can edit own, not
 *         someone else's).
 *
 * Denial UX policy (decision: requirements.md Open Q1, 2026-06-30, option B):
 *   - Production: returns the constant `GENERIC_DENIAL_MESSAGE`. No scope
 *     name / role name / member id leaks.
 *   - Dev mode (BOTH `NODE_ENV !== "production"` AND
 *     `MERISM_DEBUG_PROVIDERS === "1"`): appends a `[DEBUG]` block with the
 *     reason, missing scopes, granted scopes, and role. Both conditions
 *     required so a leaked env var in prod is still safe.
 *
 * PostHog reference: ee/hogai/README.md § Access control — two-layer policy
 * (resource + object). We borrow the shape, flip to imperative because our
 * tool builders are functional closures, not class decorators.
 */
import {
  ROLE_SCOPES,
  type WorkspaceRoleValue,
  type WorkspaceScopeValue,
} from "@merism/contracts";
import { createLogger } from "@merism/observability";

import type { ToolErrorArtifact, ToolResultEnvelope } from "./envelope";

/** Per-call workspace context. Plumbed in from the Morris route's session. */
export interface WorkspaceAccessContext {
  /** The active workspace ($id of the Appwrite Team). */
  workspaceId: string;
  /** The acting user ($id of the Appwrite Account). */
  memberId: string;
  /** The user's role within this workspace. */
  role: WorkspaceRoleValue;
  /** Inherited from the Morris request log scope; used for cross-line correlation. */
  traceId: string;
}

/**
 * Minimum resource shape the resource-level check needs. The caller loads
 * the record (one Appwrite read at most) and passes it in — this module
 * does NO I/O so it stays unit-testable without mocks.
 *
 * `workspaceId` enforces tenancy; `creatorUserId` enforces ADR-0006 D3
 * write-private for `access: "editor"`. Both fields are present on every
 * tenanted entity per `contracts.md`.
 */
export interface ResourceForAccessCheck {
  workspaceId: string;
  creatorUserId: string;
}

/** Generic copy returned in production. Constant — tests assert against it. */
export const GENERIC_DENIAL_MESSAGE = "你没有权限执行这个操作。";

type DenialReason = "scope" | "cross_workspace" | "not_creator";

interface CheckAccessOptions {
  /** Used as the logger scope suffix (`morris.tool.<toolName>`). */
  toolName: string;
  /**
   * Role-level scopes the tool requires. Empty array = no role-level check
   * (rare: only meaningful for meta tools that operate on user-scoped data
   * like memories or todoWrite UI state).
   */
  requiredScopes: readonly WorkspaceScopeValue[];
  /**
   * When set, also perform resource-level checks. Caller passes a record
   * already loaded from Appwrite. `record === null` => caller knows there's
   * no resource yet (e.g. CREATE operations) — only role-level applies.
   */
  resource?: {
    record: ResourceForAccessCheck | null;
    access: "viewer" | "editor";
  };
}

/**
 * Check workspace access. Returns `null` on grant, or a denial envelope
 * the caller `return`s from its tool `execute`.
 *
 * Pattern at the call site:
 * ```ts
 * const denied = checkWorkspaceAccess(ctx, {
 *   toolName: "createStudyDraft",
 *   requiredScopes: ["study:editor"],
 * });
 * if (denied) return denied;
 * // ... tool body ...
 * ```
 */
export function checkWorkspaceAccess(
  ctx: WorkspaceAccessContext,
  opts: CheckAccessOptions,
): ToolResultEnvelope<ToolErrorArtifact> | null {
  const logger = createLogger(`morris.tool.${opts.toolName}`, ctx.traceId);
  const granted = ROLE_SCOPES[ctx.role];
  const missing = opts.requiredScopes.filter((s) => !granted.includes(s));

  // 1. Role-level
  if (missing.length > 0) {
    logger.info("morris.tool.access_denied", {
      tool: opts.toolName,
      reason: "scope",
      required: opts.requiredScopes,
      granted,
      missing,
      workspaceId: ctx.workspaceId,
      memberId: ctx.memberId,
      role: ctx.role,
    });
    return buildDenialEnvelope({
      reason: "scope",
      required: opts.requiredScopes,
      granted,
      missing,
      role: ctx.role,
    });
  }

  // 2. Resource-level (only when caller supplied a loaded record).
  if (opts.resource && opts.resource.record !== null) {
    const r = opts.resource.record;

    if (r.workspaceId !== ctx.workspaceId) {
      logger.info("morris.tool.access_denied", {
        tool: opts.toolName,
        reason: "cross_workspace",
        resourceWorkspaceId: r.workspaceId,
        sessionWorkspaceId: ctx.workspaceId,
        memberId: ctx.memberId,
        role: ctx.role,
      });
      return buildDenialEnvelope({
        reason: "cross_workspace",
        required: opts.requiredScopes,
        granted,
        missing: [],
        role: ctx.role,
      });
    }

    if (opts.resource.access === "editor") {
      const isCreator = r.creatorUserId === ctx.memberId;
      const isAdminOrOwner = ctx.role === "admin" || ctx.role === "owner";
      if (!isCreator && !isAdminOrOwner) {
        logger.info("morris.tool.access_denied", {
          tool: opts.toolName,
          reason: "not_creator",
          resourceCreatorUserId: r.creatorUserId,
          memberId: ctx.memberId,
          role: ctx.role,
        });
        return buildDenialEnvelope({
          reason: "not_creator",
          required: opts.requiredScopes,
          granted,
          missing: [],
          role: ctx.role,
        });
      }
    }
  }

  return null;
}

/**
 * Detect dev mode for the debug-message branch.
 *
 * BOTH conditions required:
 *  - `NODE_ENV !== "production"` — even if the env flag leaks into a prod
 *    deploy, the message stays generic.
 *  - `MERISM_DEBUG_PROVIDERS === "1"` — strict literal per
 *    `errors-and-observability.md` § Feature flags rule.
 *
 * Exported for the property test (deterministic toggle without `process.env`
 * mutation across tests).
 */
export function isAccessDebugMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.MERISM_DEBUG_PROVIDERS === "1"
  );
}

interface DenialPayload {
  reason: DenialReason;
  required: readonly WorkspaceScopeValue[];
  granted: readonly WorkspaceScopeValue[];
  missing: readonly WorkspaceScopeValue[];
  role: WorkspaceRoleValue;
}

function formatDenialMessage(p: DenialPayload): string {
  if (!isAccessDebugMode()) return GENERIC_DENIAL_MESSAGE;
  return [
    GENERIC_DENIAL_MESSAGE,
    `[DEBUG] reason=${p.reason} ` +
      `required=[${p.required.join(", ")}] ` +
      `granted=[${p.granted.join(", ")}] ` +
      `missing=[${p.missing.join(", ")}] ` +
      `role=${p.role}`,
  ].join("\n");
}

function buildDenialEnvelope(
  p: DenialPayload,
): ToolResultEnvelope<ToolErrorArtifact> {
  const message = formatDenialMessage(p);
  return Object.freeze({
    content: message,
    artifact: Object.freeze({ error: true as const, message }),
  });
}
