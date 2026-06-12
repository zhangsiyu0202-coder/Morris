"use server";

import { Account, Users, Query, ID } from "node-appwrite";
import { cookies } from "next/headers";
import { ResearcherPrefsSchema, type ResearcherPrefs } from "@merism/contracts";
import {
  publicClient,
  adminClient,
  sessionClient,
  readSessionSecret,
  setSessionCookie,
  createEmailPasswordSessionSecret,
  createTokenSessionSecret,
  clearSessionCookie,
  appUrl,
} from "./appwrite";

/**
 * Researcher auth Server Actions, implemented entirely on top of Appwrite's
 * Account / Users API (no NextAuth / Better-Auth, no business `users` table).
 *
 * Security posture mirrors the patterns found across Formbricks / PostHog /
 * Rallly (see docs/design/auth-and-user-research.md §7):
 *  - no email enumeration on recovery (Appwrite's createRecovery never reveals
 *    existence; we also never surface "no such user" on that path);
 *  - the session secret is stored in an httpOnly cookie, server-side only;
 *  - email change goes through Appwrite which requires the current password.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
export type LoginMethod = "password" | "otp" | "none";

const OTP_UID_COOKIE = "merism_otp_uid";
const OTP_EMAIL_COOKIE = "merism_otp_email";
const OTP_TTL_MS = 15 * 60 * 1000;

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  if (password.length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位`;
  if (!/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "密码需包含至少一个大写字母和一个数字";
  }
  return null;
}

/**
 * Adaptive single-entry probe (Rallly pattern): given an email, decide whether
 * to show the password field, send a one-time code, or send the visitor to
 * signup. Requires the admin key to inspect the Users service.
 */
export async function probeEmail(emailRaw: string): Promise<{ method: LoginMethod }> {
  const email = normalizeEmail(emailRaw);
  if (!email) return { method: "none" };
  try {
    const users = new Users(adminClient());
    const res = await users.list([Query.equal("email", email), Query.limit(1)]);
    const user = res.users[0];
    if (!user) return { method: "none" };
    // `passwordUpdate` is an empty string when the account has no password set
    // (OAuth / OTP-only). Such users must use a code, not a password field.
    const hasPassword = typeof user.passwordUpdate === "string" && user.passwordUpdate !== "";
    return { method: hasPassword ? "password" : "otp" };
  } catch {
    // Misconfigured backend → default to password so the user can still try.
    return { method: "password" };
  }
}

export async function signInWithPassword(
  emailRaw: string,
  password: string,
): Promise<ActionResult> {
  const email = normalizeEmail(emailRaw);
  if (!email || !password) return { ok: false, error: "请输入邮箱和密码" };
  try {
    // Appwrite 1.6 returns an empty body `secret`; the real secret is in the
    // Set-Cookie header. createEmailPasswordSessionSecret reads it from there.
    const { secret, expire } = await createEmailPasswordSessionSecret(email, password);
    await setSessionCookie(secret, new Date(expire));
    return { ok: true };
  } catch {
    return { ok: false, error: "邮箱或密码错误" };
  }
}

/** Send a 6-digit login code to the email and remember the target user id. */
export async function requestEmailOtp(emailRaw: string): Promise<ActionResult> {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: "请输入邮箱" };
  try {
    const account = new Account(publicClient());
    // ID.unique() lets Appwrite resolve an existing account by email or create
    // one; the returned userId is the canonical target for createSession.
    const token = await account.createEmailToken(ID.unique(), email);
    const store = await cookies();
    const opts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      expires: new Date(Date.now() + OTP_TTL_MS),
    };
    store.set(OTP_UID_COOKIE, token.userId, opts);
    store.set(OTP_EMAIL_COOKIE, email, opts);
    return { ok: true };
  } catch {
    return { ok: false, error: "验证码发送失败,请稍后重试" };
  }
}

/** The email a pending OTP was sent to, for the verify screen to display. */
export async function getPendingOtpEmail(): Promise<string | null> {
  const store = await cookies();
  return store.get(OTP_EMAIL_COOKIE)?.value ?? null;
}

export async function verifyEmailOtp(code: string): Promise<ActionResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "请输入验证码" };
  const store = await cookies();
  const userId = store.get(OTP_UID_COOKIE)?.value;
  if (!userId) return { ok: false, error: "验证码已过期,请重新获取" };
  try {
    // Appwrite 1.6: secret is in Set-Cookie, not the body. Read it from there.
    const { secret, expire } = await createTokenSessionSecret(userId, trimmed);
    await setSessionCookie(secret, new Date(expire));
    store.delete(OTP_UID_COOKIE);
    store.delete(OTP_EMAIL_COOKIE);
    return { ok: true };
  } catch {
    return { ok: false, error: "验证码错误或已过期" };
  }
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<ActionResult> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) return { ok: false, error: "请输入姓名" };
  if (!email) return { ok: false, error: "请输入邮箱" };
  const pwError = validatePassword(input.password);
  if (pwError) return { ok: false, error: pwError };

  try {
    const account = new Account(publicClient());
    await account.create(ID.unique(), email, input.password, name);
    const { secret, expire } = await createEmailPasswordSessionSecret(email, input.password);
    await setSessionCookie(secret, new Date(expire));
    // Best-effort verification email; signup must not fail if mail is down.
    try {
      const verifyAccount = new Account(sessionClient(secret));
      await verifyAccount.createVerification(appUrl("/auth/verify"));
    } catch {
      // swallow: researcher can resend from account settings
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/already exists|user_already/i.test(message)) {
      return { ok: false, error: "该邮箱已注册,请直接登录" };
    }
    return { ok: false, error: "注册失败,请稍后重试" };
  }
}

export async function signOut(): Promise<void> {
  const secret = await readSessionSecret().catch(() => null);
  if (secret) {
    try {
      await new Account(sessionClient(secret)).deleteSession("current");
    } catch {
      // session already invalid server-side; cookie clear below is enough
    }
  }
  await clearSessionCookie();
}

/** Always returns ok — never reveals whether the email has an account. */
export async function requestPasswordRecovery(emailRaw: string): Promise<ActionResult> {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: "请输入邮箱" };
  try {
    await new Account(publicClient()).createRecovery(email, appUrl("/auth/reset"));
  } catch {
    // swallow to preserve anti-enumeration
  }
  return { ok: true };
}

export async function completePasswordRecovery(
  userId: string,
  secret: string,
  password: string,
): Promise<ActionResult> {
  const pwError = validatePassword(password);
  if (pwError) return { ok: false, error: pwError };
  try {
    await new Account(publicClient()).updateRecovery(userId, secret, password);
    return { ok: true };
  } catch {
    return { ok: false, error: "重置链接无效或已过期" };
  }
}

export async function confirmEmailVerification(
  userId: string,
  secret: string,
): Promise<ActionResult> {
  const sessionSecret = await readSessionSecret().catch(() => null);
  if (!sessionSecret) return { ok: false, error: "请先登录后再验证邮箱" };
  try {
    await new Account(sessionClient(sessionSecret)).updateVerification(userId, secret);
    return { ok: true };
  } catch {
    return { ok: false, error: "验证链接无效或已过期" };
  }
}

export async function resendEmailVerification(): Promise<ActionResult> {
  const secret = await readSessionSecret().catch(() => null);
  if (!secret) return { ok: false, error: "请先登录" };
  try {
    await new Account(sessionClient(secret)).createVerification(appUrl("/auth/verify"));
    return { ok: true };
  } catch {
    return { ok: false, error: "发送失败,请稍后重试" };
  }
}

// ---- account settings ----

async function requireSessionSecret(): Promise<string> {
  const secret = await readSessionSecret();
  if (!secret) throw new Error("not_authenticated");
  return secret;
}

export async function updateResearcherName(name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "请输入姓名" };
  try {
    await new Account(sessionClient(await requireSessionSecret())).updateName(trimmed);
    return { ok: true };
  } catch {
    return { ok: false, error: "更新失败" };
  }
}

export async function updateResearcherEmail(
  emailRaw: string,
  password: string,
): Promise<ActionResult> {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: "请输入新邮箱" };
  if (!password) return { ok: false, error: "请输入当前密码以确认改邮箱" };
  try {
    const secret = await requireSessionSecret();
    const account = new Account(sessionClient(secret));
    await account.updateEmail(email, password);
    try {
      await account.createVerification(appUrl("/auth/verify"));
    } catch {
      // verification mail best-effort
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "改邮箱失败,请确认密码正确且邮箱未被占用" };
  }
}

export async function updateResearcherPassword(
  newPassword: string,
  oldPassword: string,
): Promise<ActionResult> {
  const pwError = validatePassword(newPassword);
  if (pwError) return { ok: false, error: pwError };
  if (!oldPassword) return { ok: false, error: "请输入当前密码" };
  try {
    await new Account(sessionClient(await requireSessionSecret())).updatePassword(
      newPassword,
      oldPassword,
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "改密失败,请确认当前密码正确" };
  }
}

export async function updateResearcherPrefs(
  prefsInput: ResearcherPrefs,
): Promise<ActionResult> {
  const prefs = ResearcherPrefsSchema.parse(prefsInput);
  try {
    await new Account(sessionClient(await requireSessionSecret())).updatePrefs(prefs);
    return { ok: true };
  } catch {
    return { ok: false, error: "保存失败" };
  }
}
