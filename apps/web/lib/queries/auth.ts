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
