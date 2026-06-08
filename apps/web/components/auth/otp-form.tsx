"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyEmailOtp, requestEmailOtp } from "@/lib/auth/actions";
import {
  AuthHeading,
  FieldLabel,
  FormNote,
  inputClass,
  primaryBtnClass,
  linkClass,
} from "./ui";

/** Enter the 6-digit code emailed by `requestEmailOtp`. */
export function OtpForm({ email, callbackUrl }: { email: string; callbackUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await verifyEmailOtp(code);
      if (res.ok) router.replace(callbackUrl);
      else setError(res.error);
    });
  }

  function resend() {
    setError("");
    setResent(false);
    startTransition(async () => {
      const res = await requestEmailOtp(email);
      if (res.ok) setResent(true);
      else setError(res.error);
    });
  }

  return (
    <>
      <AuthHeading title="输入验证码" subtitle={`我们已向 ${email} 发送了 6 位登录验证码。`} />
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="code">验证码</FieldLabel>
          <input
            id="code"
            inputMode="numeric"
            autoFocus
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputClass} tracking-[0.4em]`}
            placeholder="------"
          />
        </div>
        {resent ? <FormNote tone="info">验证码已重新发送。</FormNote> : null}
        <FormNote>{error}</FormNote>
        <button type="submit" disabled={pending} className={primaryBtnClass}>
          {pending ? "验证中…" : "登录"}
        </button>
      </form>
      <div className="mt-4 text-center">
        <button type="button" onClick={resend} disabled={pending} className={linkClass}>
          没收到?重新发送
        </button>
      </div>
    </>
  );
}
