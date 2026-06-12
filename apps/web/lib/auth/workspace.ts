import { Teams } from "node-appwrite";
import { sessionClient, readSessionSecret } from "@/lib/auth/appwrite";

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
