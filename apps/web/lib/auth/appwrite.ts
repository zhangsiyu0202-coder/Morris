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
