import { randomUUID } from "node:crypto";

import { Teams } from "node-appwrite";
import { sessionClient, readSessionSecret } from "@/lib/auth/appwrite";
import { getRuntimeTraceId } from "@merism/observability";

import type { WorkspaceAccessContext } from "@/lib/assistant/access-control";
import { getCurrentUserId } from "@/lib/queries/auth";

/**
 * Workspace = Appwrite Team (ADR-0006 D1: `teamId === workspaceId`). Membership
 * is resolved straight from Appwrite's NATIVE Teams API — there is no bespoke
 * membership collection. A researcher with no team resolves to `null` (solo).
 *
 * Used by the WRITE paths (createSurvey / createBookmark) to stamp
 * `Permission.read(Role.team(workspaceId))` on new docs. READS no longer resolve
 * a workspace at all — they run through the session client and Appwrite enforces
 * Role.team / Role.user natively (ADR-0006 B), so there is no in-code tenant
 * scope to thread.
 *
 * Server contexts only (Server Actions / RSC / route handlers).
 */

/** Resolve the signed-in researcher's workspace (Appwrite Team `$id`), or null. */
export async function getCurrentWorkspaceId(): Promise<string | null> {
  // nosemgrep: no-silent-catch-fallback (no request context / appwrite not configured / expired session → solo mode)
  try {
    const secret = await readSessionSecret();
    if (!secret) return null;
    const result = await new Teams(sessionClient(secret)).list();
    return result.teams[0]?.$id ?? null;
  } catch {
    // No request context / appwrite_not_configured / expired session → solo.
    return null;
  }
}

/**
 * Build the WorkspaceAccessContext used by Morris tools' access-control gate
 * (robustness-hardening REQ-4). Returns null when:
 *  - user is not signed in,
 *  - user has no workspace (solo researcher legacy path),
 *  - Appwrite is unreachable / errors.
 *
 * Wave A simplifications (documented; sub-spec will tighten):
 *  - `role` is hardcoded to `"member"` (most-restrictive). Appwrite Permissions
 *    are the canonical data-isolation source today; the Morris layer logs the
 *    intent but does not yet differentiate by role at the resource level.
 *  - `traceId` is generated fresh per call. Routes that want correlation across
 *    multiple checks in one request can pass a pre-generated traceId to the
 *    overload below.
 */
export async function getCurrentWorkspaceAccessContext(
  traceId?: string,
): Promise<WorkspaceAccessContext | null> {
  const resolvedTraceId = traceId ?? getRuntimeTraceId() ?? randomUUID();
  const [workspaceId, memberId] = await Promise.all([
    getCurrentWorkspaceId(),
    getCurrentUserId(),
  ]);
  if (!workspaceId || !memberId) return null;
  return {
    workspaceId,
    memberId,
    // TODO(robustness-hardening REQ-4 follow-up): resolve real role via
    // Appwrite Teams listMemberships once a role-differentiated scope
    // (workspace:settings / billing:edit) lands. Defaulting to the most-
    // restrictive role is safe because Appwrite Permissions (Role.team /
    // Role.user) already enforce per-resource access at the storage layer.
    role: "member",
    traceId: resolvedTraceId,
  };
}
