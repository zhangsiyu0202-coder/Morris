"use client";

import { useState, useTransition } from "react";
import { requestPasswordRecovery } from "@/lib/auth/actions";
import {
  AuthHeading,
  FieldLabel,
  FormNote,
  inputClass,
  primaryBtnClass,
  linkClass,
} from "./ui";
import Link from "next/link";

export function RecoverForm() {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await requestPasswordRecovery(email);
      if (res.ok) setSent(true);
      else setError(res.error);
    });
  }

  if (sent) {
    return (
      <>
        <AuthHeading
          title="请查收邮件"
          subtitle={`如果 ${email} 已注册,我们已发送密码重置链接。请检查收件箱(含垃圾邮件)。`}
        />
        <Link href="/login" className={primaryBtnClass}>
          返回登录
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="重置密码" subtitle="输入账号邮箱,我们会发送一封重置链接。" />
      <form onSubmit={onSubmit} className="space-y-4">
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
          {pending ? "发送中…" : "发送重置链接"}
        </button>
      </form>
      <p className="mt-6 text-center font-ui text-body-sm text-ink-400">
        <Link href="/login" className={linkClass}>
          返回登录
        </Link>
      </p>
    </>
  );
}
