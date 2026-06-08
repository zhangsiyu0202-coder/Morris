import { getCurrentUserId } from "@/lib/queries/auth";

/**
 * Researcher owner resolution.
 *
 * The researcher's identity is the Appwrite Account `$id`, read from the session
 * cookie (`getCurrentUserId`). Every owner-scoped read/write gates on this id.
 *
 * Two flavours:
 *  - `getOwnerUserIdOrNull()` for read paths that must degrade gracefully (return
 *    empty/mock when signed out, rather than crash).
 *  - `requireOwnerUserId()` for write paths (Server Actions) that must refuse to
 *    run without an authenticated researcher.
 *
 * Server contexts only.
 */
export async function getOwnerUserIdOrNull(): Promise<string | null> {
  return getCurrentUserId();
}

export async function requireOwnerUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Error("not_authenticated");
  return id;
}
