import { Teams } from "node-appwrite";
import { type TenantScope } from "@/lib/queries/client";
import { getCurrentUserId } from "@/lib/queries/auth";
import { sessionClient, readSessionSecret } from "@/lib/auth/appwrite";

export type { TenantScope };

/**
 * Workspace = Appwrite Team (ADR-0006 D1: `teamId === workspaceId`). Membership
 * is resolved straight from Appwrite's NATIVE Teams API — there is no bespoke
 * membership collection to read or keep in sync. A researcher with no team
 * resolves to `null` and falls back to legacy single-researcher (`ownerUserId`)
 * scoping so the product works before/without workspaces.
 *
 * v1 assumes one active workspace per user (we pick the first team). A
 * multi-workspace "active workspace" preference is intentionally out of scope.
 *
 * Server contexts only (Server Actions / RSC / route handlers).
 */

/** Resolve the signed-in researcher's workspace (Appwrite Team `$id`), or null. */
export async function getCurrentWorkspaceId(): Promise<string | null> {
  try {
    const secret = await readSessionSecret();
    if (!secret) return null;
    // `teams.list()` runs AS the researcher and returns only the teams they
    // belong to — Appwrite's membership engine is the source of truth.
    const result = await new Teams(sessionClient(secret)).list();
    return result.teams[0]?.$id ?? null;
  } catch {
    // No request context / appwrite_not_configured / expired session / no Teams
    // scope → solo fallback (ownerUserId scoping).
    return null;
  }
}

/** Resolve the signed-in researcher's tenant scope, or `null` when signed out. */
export async function getCurrentTenantScope(): Promise<TenantScope | null> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return null;
  return { ownerUserId, workspaceId: await getCurrentWorkspaceId() };
}

/**
 * Build a tenant scope for an already-known current-researcher `ownerUserId`
 * (e.g. a Morris tool's `ctx.ownerUserId`, or a data-layer function that
 * received the id as a param). The workspace is resolved from the active
 * session's native Team membership.
 *
 * NOTE: tenant isolation is still enforced in-code via `tenantFilter`
 * (`@/lib/queries/client`) because reads run through the API-key client which
 * bypasses Appwrite permissions. Once reads move to the user's session client,
 * `Role.team(workspaceId)` document permissions enforce it natively — that
 * switch must be verified against the live Appwrite stack, so it is a separate
 * slice.
 */
export async function scopeForOwner(ownerUserId: string): Promise<TenantScope> {
  return { ownerUserId, workspaceId: await getCurrentWorkspaceId() };
}
