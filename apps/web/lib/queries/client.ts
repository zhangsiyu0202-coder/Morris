import { Client, Databases, Query } from "node-appwrite";

/**
 * Server-side Appwrite singleton for the web app's read layer.
 *
 * Only used inside server contexts (Next.js Server Actions, RSC, route
 * handlers). Browser code must NOT import from `lib/queries/*`; the browser
 * uses the `appwrite` Web SDK with researcher session cookies, not the
 * server API key.
 *
 * The server key in `APPWRITE_API_KEY` bypasses Appwrite's Permission rules,
 * so every query in this layer takes an explicit `ownerUserId` and adds a
 * `Query.equal("ownerUserId", ...)` filter. That single rule keeps the read
 * layer ownership-safe even when the bypass key is in use.
 */

declare global {
  // eslint-disable-next-line no-var
  var __merism_queries_client: { client: Client; databases: Databases } | undefined;
}

function build(): { client: Client; databases: Databases } {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!endpoint || !projectId || !apiKey) {
    // The read layer is opt-in. If the env is not configured (e.g. local dev
    // before the stack is up), throw a clear, named error so callers can
    // present a friendly empty state rather than a stack trace.
    throw new Error("appwrite_not_configured");
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return { client, databases: new Databases(client) };
}

export function getServerClient(): { client: Client; databases: Databases } {
  if (!globalThis.__merism_queries_client) {
    globalThis.__merism_queries_client = build();
  }
  return globalThis.__merism_queries_client;
}

export const DATABASE_ID = "merism";

/** Re-export Query so callers don't need to import node-appwrite directly. */
export { Query };

/**
 * Databases bound to the CURRENT researcher's session. Reads through this client
 * are enforced by Appwrite's permission engine — a row is returned only when the
 * caller has `read(user:self)` or `read(team:theirWorkspace)` on it (ADR-0006 B
 * native tenant isolation), so the read layer needs no in-code tenant filter.
 *
 * `@/lib/auth/appwrite` (which imports `next/headers`) is loaded dynamically so
 * this module stays importable in the query unit tests, which inject a
 * Databases mock and never reach this path.
 */
export async function getSessionDb(): Promise<Databases> {
  const { readSessionSecret, sessionClient } = await import("@/lib/auth/appwrite");
  const secret = await readSessionSecret();
  if (!secret) throw new Error("not_authenticated");
  return new Databases(sessionClient(secret));
}
