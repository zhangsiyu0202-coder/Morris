"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completePasswordRecovery } from "@/lib/auth/actions";
import {
  AuthHeading,
  FieldLabel,
  FormNote,
  inputClass,
  primaryBtnClass,
  linkClass,
} from "./ui";

export function ResetForm({ userId, secret }: { userId: string; secret: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const invalid = !userId || !secret;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await completePasswordRecovery(userId, secret, password);
      if (res.ok) {
        setDone(true);
        setTimeout(() => router.replace("/login"), 1200);
      } else {
        setError(res.error);
      }
    });
  }

  if (invalid) {
    return (
      <>
        <AuthHeading title="链接无效" subtitle="重置链接缺少参数或已损坏,请重新申请。" />
        <Link href="/auth/recover" className={primaryBtnClass}>
          重新申请
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthHeading title="密码已更新" subtitle="正在带你回到登录页…" />
        <Link href="/login" className={linkClass}>
          立即登录
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="设置新密码" subtitle="为账号设置一个新密码。" />
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="password">新密码</FieldLabel>
          <input
            id="password"
            type="password"
            autoFocus
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1.5 font-ui text-caption text-ink-400">
            至少 8 位,包含大写字母与数字。
          </p>
        </div>
        <FormNote>{error}</FormNote>
        <button type="submit" disabled={pending} className={primaryBtnClass}>
          {pending ? "更新中…" : "更新密码"}
        </button>
      </form>
    </>
  );
}
