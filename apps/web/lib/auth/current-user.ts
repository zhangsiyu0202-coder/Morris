import { Account } from "node-appwrite";
import { redirect } from "next/navigation";
import { ResearcherPrefsSchema, type CurrentResearcher } from "@merism/contracts";
import { readSessionSecret, sessionClient } from "./appwrite";

/**
 * Resolve the currently authenticated researcher from the Appwrite Account,
 * projected to the `CurrentResearcher` read-view. Returns null when there is no
 * valid session (no cookie, expired, or the backend is unreachable) so callers
 * can render a signed-out state or redirect.
 *
 * Server contexts only.
 */
export async function getCurrentResearcher(): Promise<CurrentResearcher | null> {
  let secret: string | null = null;
  try {
    secret = await readSessionSecret();
  } catch {
    return null;
  }
  if (!secret) return null;

  try {
    const account = new Account(sessionClient(secret));
    const user = await account.get();
    const prefs = ResearcherPrefsSchema.parse(user.prefs ?? {});
    return {
      id: user.$id,
      email: user.email,
      name: user.name || user.email,
      emailVerified: Boolean(user.emailVerification),
      prefs,
    };
  } catch {
    return null;
  }
}

/**
 * Require a logged-in researcher in a Server Component / Server Action. Redirects
 * to `/login?callbackUrl=...` when not authenticated and never returns null.
 */
export async function requireResearcher(callbackPath?: string): Promise<CurrentResearcher> {
  const researcher = await getCurrentResearcher();
  if (!researcher) {
    const suffix = callbackPath ? `?callbackUrl=${encodeURIComponent(callbackPath)}` : "";
    redirect(`/login${suffix}`);
  }
  return researcher;
}
