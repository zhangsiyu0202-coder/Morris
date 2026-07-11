"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { confirmEmailVerification } from "@/lib/auth/actions";
import { AuthHeading, primaryBtnClass, linkClass } from "./ui";

/**
 * Confirms an email verification link. Appwrite appends `?userId=&secret=` to
 * the configured URL; we POST them once via the server action and show the
 * result. The user is expected to be logged in (signup created a session).
 */
export function VerifyEmailClient({ userId, secret }: { userId: string; secret: string }) {
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!userId || !secret) {
      setState("error");
      setMessage("验证链接缺少参数。");
      return;
    }
    confirmEmailVerification(userId, secret).then((res) => {
      if (res.ok) setState("ok");
      else {
        setState("error");
        setMessage(res.error);
      }
    });
  }, [userId, secret]);

  if (state === "pending") {
    return <AuthHeading title="正在验证邮箱…" subtitle="请稍候。" />;
  }

  if (state === "ok") {
    return (
      <>
        <AuthHeading title="邮箱已验证" subtitle="你的研究者账号已完成邮箱验证。" />
        <Link href="/home" className={primaryBtnClass}>
          进入工作台
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="验证失败" subtitle={message || "验证链接无效或已过期。"} />
      <Link href="/settings/account" className={linkClass}>
        前往账户设置重新发送
      </Link>
    </>
  );
}
