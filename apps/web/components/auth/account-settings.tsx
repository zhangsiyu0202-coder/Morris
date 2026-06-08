"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CurrentResearcher } from "@merism/contracts";
import {
  updateResearcherName,
  updateResearcherEmail,
  updateResearcherPassword,
  updateResearcherPrefs,
  resendEmailVerification,
  signOut,
  type ActionResult,
} from "@/lib/auth/actions";
import { FieldLabel, FormNote, inputClass, ghostBtnClass } from "./ui";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-ink-0 p-6 shadow-sm">
      <h2 className="font-display text-display-md font-semibold text-ink-900">{title}</h2>
      {description ? (
        <p className="mt-1 font-ui text-body-sm leading-6 text-ink-400">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AccountSettings({ researcher }: { researcher: CurrentResearcher }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(researcher.name);
  const [nameNote, setNameNote] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const [email, setEmail] = useState(researcher.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [emailNote, setEmailNote] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwNote, setPwNote] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const [locale, setLocale] = useState(researcher.prefs.locale);
  const [sessionCompleted, setSessionCompleted] = useState(
    researcher.prefs.notifications.sessionCompleted,
  );
  const [reportReady, setReportReady] = useState(researcher.prefs.notifications.reportReady);
  const [prefsNote, setPrefsNote] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const [verifyNote, setVerifyNote] = useState("");

  function run(
    action: () => Promise<ActionResult>,
    onResult: (note: { tone: "error" | "info"; text: string }) => void,
    successText: string,
  ) {
    startTransition(async () => {
      const res = await action();
      onResult(res.ok ? { tone: "info", text: successText } : { tone: "error", text: res.error });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-12">
      <header>
        <p className="font-ui text-caption font-medium uppercase tracking-wider text-ink-400">
          Account
        </p>
        <h1 className="mt-1 font-display text-display-lg text-ink-900">账户设置</h1>
      </header>

      {!researcher.emailVerified ? (
        <div className="flex flex-col gap-3 rounded-xl bg-mauve-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-ui text-body-sm font-semibold text-ink-900">邮箱尚未验证</p>
            <p className="mt-0.5 font-ui text-body-sm text-ink-600">
              验证邮箱以确保能收到访谈完成与报告就绪通知。
            </p>
            {verifyNote ? (
              <p className="mt-1 font-ui text-caption text-ink-600">{verifyNote}</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await resendEmailVerification();
                setVerifyNote(res.ok ? "验证邮件已发送。" : res.error);
              })
            }
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-ink-0 disabled:opacity-50"
          >
            发送验证邮件
          </button>
        </div>
      ) : null}

      <Section title="个人资料">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateResearcherName(name), setNameNote, "已保存");
          }}
          className="space-y-4"
        >
          <div>
            <FieldLabel htmlFor="name">姓名</FieldLabel>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          {nameNote ? <FormNote tone={nameNote.tone}>{nameNote.text}</FormNote> : null}
          <div className="flex justify-end">
            <button type="submit" disabled={pending} className="w-auto px-5 py-2.5 inline-flex items-center justify-center rounded-lg bg-mauve-200 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50">
              保存
            </button>
          </div>
        </form>
      </Section>

      <Section title="邮箱" description="修改邮箱需要输入当前密码,修改后需重新验证新邮箱。">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => updateResearcherEmail(email, emailPassword),
              (n) => {
                setEmailNote(n);
                if (n.tone === "info") setEmailPassword("");
              },
              "邮箱已更新,请查收验证邮件",
            );
          }}
          className="space-y-4"
        >
          <div>
            <FieldLabel htmlFor="email">邮箱</FieldLabel>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel htmlFor="email-password">当前密码</FieldLabel>
            <input
              id="email-password"
              type="password"
              autoComplete="current-password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          {emailNote ? <FormNote tone={emailNote.tone}>{emailNote.text}</FormNote> : null}
          <div className="flex justify-end">
            <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-lg bg-mauve-200 px-5 py-2.5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50">
              更新邮箱
            </button>
          </div>
        </form>
      </Section>

      <Section title="密码">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => updateResearcherPassword(newPassword, oldPassword),
              (n) => {
                setPwNote(n);
                if (n.tone === "info") {
                  setOldPassword("");
                  setNewPassword("");
                }
              },
              "密码已更新",
            );
          }}
          className="space-y-4"
        >
          <div>
            <FieldLabel htmlFor="old-password">当前密码</FieldLabel>
            <input
              id="old-password"
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel htmlFor="new-password">新密码</FieldLabel>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1.5 font-ui text-caption text-ink-400">
              至少 8 位,包含大写字母与数字。
            </p>
          </div>
          {pwNote ? <FormNote tone={pwNote.tone}>{pwNote.text}</FormNote> : null}
          <div className="flex justify-end">
            <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-lg bg-mauve-200 px-5 py-2.5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50">
              更新密码
            </button>
          </div>
        </form>
      </Section>

      <Section title="偏好">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                updateResearcherPrefs({
                  locale,
                  timeZone: researcher.prefs.timeZone,
                  notifications: { sessionCompleted, reportReady },
                }),
              setPrefsNote,
              "已保存",
            );
          }}
          className="space-y-4"
        >
          <div>
            <FieldLabel htmlFor="locale">界面语言</FieldLabel>
            <select
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className={inputClass}
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
          <label className="flex items-center justify-between font-ui text-body-sm text-ink-800">
            访谈完成时通知我
            <input
              type="checkbox"
              checked={sessionCompleted}
              onChange={(e) => setSessionCompleted(e.target.checked)}
              className="size-4 accent-mauve-400"
            />
          </label>
          <label className="flex items-center justify-between font-ui text-body-sm text-ink-800">
            报告就绪时通知我
            <input
              type="checkbox"
              checked={reportReady}
              onChange={(e) => setReportReady(e.target.checked)}
              className="size-4 accent-mauve-400"
            />
          </label>
          {prefsNote ? <FormNote tone={prefsNote.tone}>{prefsNote.text}</FormNote> : null}
          <div className="flex justify-end">
            <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-lg bg-mauve-200 px-5 py-2.5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50">
              保存
            </button>
          </div>
        </form>
      </Section>

      <Section title="会话">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await signOut();
              router.replace("/login");
            })
          }
          className={ghostBtnClass}
        >
          退出登录
        </button>
      </Section>
    </div>
  );
}
