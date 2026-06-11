import { Client } from "node-appwrite";
import { cookies } from "next/headers";

/**
 * Server-side Appwrite client factories and session-cookie helpers for the
 * researcher auth module.
 *
 * Three client flavours, never mixed:
 *  - publicClient(): endpoint + project only. For unauthenticated flows that
 *    Appwrite scopes by a secret in the request body (login, OTP token, email
 *    recovery request/confirm). No API key, no session.
 *  - sessionClient(secret): adds `.setSession(secret)` so calls run AS the
 *    researcher (account.get / updateName / updatePassword / verification).
 *  - adminClient(): adds the server API key. Bypasses permissions; used only to
 *    probe whether an email already has an account (Users.list).
 *
 * The session secret lives in an httpOnly cookie named `a_session_<projectId>`,
 * which is also what `lib/queries/auth.ts::getCurrentUserId` reads — so the read
 * layer lights up the moment login sets this cookie.
 *
 * Server contexts only (Server Actions / RSC / route handlers). Never import
 * from client components.
 */

type AppwriteEnv = { endpoint: string; projectId: string };

function envOrNull(): AppwriteEnv | null {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  if (!endpoint || !projectId) return null;
  return { endpoint, projectId };
}

/** Throws the repo-standard `appwrite_not_configured` when env is missing. */
function envOrThrow(): AppwriteEnv {
  const env = envOrNull();
  if (!env) throw new Error("appwrite_not_configured");
  return env;
}

export function sessionCookieName(): string | null {
  const env = envOrNull();
  return env ? `a_session_${env.projectId}` : null;
}

export function publicClient(): Client {
  const { endpoint, projectId } = envOrThrow();
  return new Client().setEndpoint(endpoint).setProject(projectId);
}

export function sessionClient(secret: string): Client {
  const { endpoint, projectId } = envOrThrow();
  return new Client().setEndpoint(endpoint).setProject(projectId).setSession(secret);
}

export function adminClient(): Client {
  const { endpoint, projectId } = envOrThrow();
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!apiKey) throw new Error("appwrite_not_configured");
  return new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
}

export async function readSessionSecret(): Promise<string | null> {
  const name = sessionCookieName();
  if (!name) return null;
  const store = await cookies();
  return store.get(name)?.value ?? null;
}

export async function setSessionCookie(secret: string, expire: Date): Promise<void> {
  const name = sessionCookieName();
  if (!name) throw new Error("appwrite_not_configured");
  const store = await cookies();
  store.set(name, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expire,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const name = sessionCookieName();
  if (!name) return;
  const store = await cookies();
  store.delete(name);
}

/** Absolute URL for Appwrite email links (verification / recovery landing). */
export function appUrl(path: string): string {
  const base =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * Create an email/password session and return the REAL session secret.
 *
 * Appwrite 1.6 returns an empty `secret` in the session-create response body and
 * delivers the actual secret only via the `Set-Cookie: a_session_<projectId>`
 * header. The typed SDK surfaces only the (empty) body, so we issue the request
 * directly and read the secret from the response cookie. The returned value
 * authenticates `account.get()` via `setSession(secret)` (verified on 1.6.0).
 */
export async function createEmailPasswordSessionSecret(
  email: string,
  password: string,
): Promise<{ secret: string; expire: string }> {
  const { endpoint, projectId } = envOrThrow();
  const res = await fetch(`${endpoint}/account/sessions/email`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Appwrite-Project": projectId },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`session_create_failed_${res.status}`);
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const target = cookies.find((c) => c.startsWith(`a_session_${projectId}=`));
  const match = target ? /^[^=]+=([^;]+)/.exec(target) : null;
  if (!match) throw new Error("session_cookie_missing");
  const body = (await res.json().catch(() => ({}))) as { expire?: string };
  const expire = body.expire ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return { secret: decodeURIComponent(match[1]), expire };
}
