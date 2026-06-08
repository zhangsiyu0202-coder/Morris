"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  probeEmail,
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
 * Adaptive single-entry login (Rallly pattern): the visitor types an email; we
 * probe how that account authenticates and either reveal a password field, send
 * a one-time code, or point them to signup. A "use a code instead" escape hatch
 * is always available once an account is known.
 */
export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"email" | "password" | "no-account">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const { method } = await probeEmail(email);
      if (method === "password") {
        setStep("password");
      } else if (method === "otp") {
        const res = await requestEmailOtp(email);
        if (res.ok) router.push(`/login/verify?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        else setError(res.error);
      } else {
        setStep("no-account");
      }
    });
  }

  function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await signInWithPassword(email, password);
      if (res.ok) router.replace(callbackUrl);
      else setError(res.error);
    });
  }

  function useCodeInstead() {
    setError("");
    startTransition(async () => {
      const res = await requestEmailOtp(email);
      if (res.ok) router.push(`/login/verify?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      else setError(res.error);
    });
  }

  if (step === "no-account") {
    return (
      <>
        <AuthHeading title="未找到账号" subtitle={`${email} 还没有注册研究者账号。`} />
        <Link href={`/signup?email=${encodeURIComponent(email)}`} className={primaryBtnClass}>
          创建账号
        </Link>
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setError("");
          }}
          className="mt-3 block w-full text-center font-ui text-body-sm text-ink-400 hover:text-ink-900"
        >
          换个邮箱
        </button>
      </>
    );
  }

  if (step === "password") {
    return (
      <>
        <AuthHeading title="输入密码" subtitle={email} />
        <form onSubmit={onPasswordSubmit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="password">密码</FieldLabel>
            <input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <FormNote>{error}</FormNote>
          <button type="submit" disabled={pending} className={primaryBtnClass}>
            {pending ? "登录中…" : "登录"}
          </button>
        </form>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={useCodeInstead} disabled={pending} className={linkClass}>
            改用邮箱验证码
          </button>
          <Link href="/auth/recover" className={linkClass}>
            忘记密码?
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="登录" subtitle="输入邮箱继续。我们会自动选择最合适的登录方式。" />
      <form onSubmit={onEmailSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="email">邮箱</FieldLabel>
          <input
            id="email"
            type="email"
            autoFocus
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>
        <FormNote>{error}</FormNote>
        <button type="submit" disabled={pending} className={primaryBtnClass}>
          {pending ? "请稍候…" : "继续"}
        </button>
      </form>
      <p className="mt-6 text-center font-ui text-body-sm text-ink-400">
        还没有账号?{" "}
        <Link href="/signup" className={linkClass}>
          注册
        </Link>
      </p>
    </>
  );
}
