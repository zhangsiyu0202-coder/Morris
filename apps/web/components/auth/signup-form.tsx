"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth/actions";
import {
  AuthHeading,
  FieldLabel,
  FormNote,
  inputClass,
  primaryBtnClass,
  linkClass,
} from "./ui";

export function SignupForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await signUp({ name, email, password });
      if (res.ok) router.replace("/home");
      else setError(res.error);
    });
  }

  return (
    <>
      <AuthHeading title="创建研究者账号" subtitle="注册后即可创建调研、查看访谈与分析报告。" />
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="name">姓名</FieldLabel>
          <input
            id="name"
            type="text"
            autoFocus
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel htmlFor="email">邮箱</FieldLabel>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <FieldLabel htmlFor="password">密码</FieldLabel>
          <input
            id="password"
            type="password"
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
          {pending ? "创建中…" : "创建账号"}
        </button>
      </form>
      <p className="mt-6 text-center font-ui text-body-sm text-ink-400">
        已有账号?{" "}
        <Link href="/login" className={linkClass}>
          登录
        </Link>
      </p>
    </>
  );
}
