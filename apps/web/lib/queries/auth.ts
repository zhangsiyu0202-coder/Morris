import { Client, Account } from "node-appwrite";
import { cookies } from "next/headers";

/**
 * Resolve the current researcher's Appwrite user id from the cookie session.
 *
 * Server-side only. Returns null when no session cookie is present or the
 * session is invalid; pages must handle that gracefully (redirect to login or
 * render an empty/error state).
 *
 * The cookie name follows Appwrite's `a_session_<projectId>` convention; the
 * Appwrite Web SDK sets this cookie on successful login.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  if (!endpoint || !projectId) return null;

  const store = await cookies();
  const sessionCookie = store.get(`a_session_${projectId}`);
  if (!sessionCookie?.value) return null;

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setSession(sessionCookie.value);

  try {
    const user = await new Account(client).get();
    return user.$id;
  } catch {
    return null;
  }
}

/**
 * Minimal researcher profile shape needed by Morris agent_context auto-injection.
 * Returned by `getCurrentUserProfile`. We expose only the three fields the system
 * prompt actually renders — never preferences / labels / phone.
 */
export interface CurrentUserProfile {
  $id: string;
  name: string;
  email: string;
}

/**
 * Resolve the current researcher's full profile (id + name + email) from the
 * Appwrite cookie session. Returns null on any failure path:
 *   - APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID env missing
 *   - no session cookie
 *   - Appwrite Account.get() throws (expired session, network error, ...)
 *
 * Server-side only. Used by `apps/web/lib/assistant/agent-context.ts` to inject
 * "你是哪位研究员" into the Morris system prompt; pages that need only the id
 * keep using the lighter `getCurrentUserId`.
 */
export async function getCurrentUserProfile(): Promise<CurrentUserProfile | null> {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  if (!endpoint || !projectId) return null;

  const store = await cookies();
  const sessionCookie = store.get(`a_session_${projectId}`);
  if (!sessionCookie?.value) return null;

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setSession(sessionCookie.value);

  try {
    const user = await new Account(client).get();
    return {
      $id: user.$id,
      name: user.name ?? "",
      email: user.email ?? "",
    };
  } catch {
    return null;
  }
}
