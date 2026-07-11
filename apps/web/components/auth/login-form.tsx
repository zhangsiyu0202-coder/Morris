"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  signInWithPassword,
  requestEmailOtp,
} from "@/lib/auth/actions";
import {
  AuthHeading,
  FieldLabel,
  FormNote,
  inputClass,
  primaryBtnClass,
  linkClass,
} from "./ui";

/**
 * Unified login form: asks for email and password simultaneously.
 * A fallback to request an OTP is provided if the user forgets their password.
 */
export function LoginForm({ callbackUrl, initialError = "" }: { callbackUrl: string; initialError?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);

  function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("请输入邮箱和密码");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await signInWithPassword(email, password);
      if (res.ok) {
        router.replace(callbackUrl);
      } else {
        setError(res.error);
      }
    });
  }

  function useCodeInstead() {
    if (!email) {
      setError("请先输入邮箱以获取验证码");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await requestEmailOtp(email);
      if (res.ok) {
        router.push(`/login/verify?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <AuthHeading title="欢迎回来" subtitle="登录您的研究者工作台" />
      <form onSubmit={onPasswordSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="email">邮箱地址</FieldLabel>
          <input
            id="email"
            type="email"
            autoFocus
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="researcher@merism.local"
            disabled={pending}
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block font-ui text-body-sm text-ink-600">
              密码
            </label>
            <Link href="/auth/recover" className={linkClass}>
              忘记密码？
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            disabled={pending}
          />
        </div>
        <FormNote>{error}</FormNote>
        <button type="submit" disabled={pending} className={primaryBtnClass}>
          {pending ? "登录中…" : "登 录"}
        </button>
      </form>
      <div className="mt-4 flex items-center justify-center">
        <button type="button" onClick={useCodeInstead} disabled={pending} className={linkClass}>
          改用邮箱验证码登录
        </button>
      </div>
      <p className="mt-6 text-center font-ui text-body-sm text-ink-400">
        还没有账号?{" "}
        <Link href="/signup" className={linkClass}>
          申请访问权限
        </Link>
      </p>
    </>
  );
}
