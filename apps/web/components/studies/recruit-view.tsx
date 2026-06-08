"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Bot, Globe, Copy, Check, PauseCircle, RefreshCw } from "lucide-react";
import type { InterviewLink } from "@merism/contracts";
import { createInterviewLink, revokeInterviewLink } from "@/lib/actions/links";

/**
 * 招募视图 — 真实链接管理。
 *
 * "分享链接" 标签下展示 surveyId 对应的 interview_links 列表,并允许
 * 新建/停用。不包含任何计费、配额、第三方招募面板等概念
 * (见 AGENTS.md 永久排除项)。
 */

type Choice = "link" | "test" | "external";

const CARDS: {
  id: Choice;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  desc: string;
}[] = [
  { id: "link", icon: Link2, title: "分享链接", desc: "通过匿名链接邀请受访者参与访谈。" },
  { id: "test", icon: Bot, title: "测试访谈", desc: "在正式招募前，自己先体验一遍访谈流程。" },
  { id: "external", icon: Globe, title: "外部渠道", desc: "对接外部受访渠道。敬请期待。" },
];

const MODE_LABELS: Record<InterviewLink["mode"], string> = {
  single_use: "单次使用",
  reusable: "多次使用",
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="复制链接"
      className="grid size-6 shrink-0 place-items-center rounded text-ink-400 transition-colors hover:bg-mauve-100 hover:text-ink-900"
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={2} />
      ) : (
        <Copy className="size-3.5" strokeWidth={2} />
      )}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 font-ui text-body-sm font-semibold text-ink-900">{children}</h2>;
}

// ---------------------------------------------------------------------------
// Confirm revoke dialog
// ---------------------------------------------------------------------------

function ConfirmRevokeDialog({
  open,
  onClose,
  onConfirm,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-dialog-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-ink-200 bg-ink-0 p-6 shadow-lg">
        <h2
          id="revoke-dialog-title"
          className="mb-2 font-ui text-display-md font-semibold text-ink-900"
        >
          确认停用此链接？
        </h2>
        <p className="mb-6 font-ui text-body-sm text-ink-600">
          停用后使用该链接的受访者将无法加入访谈。此操作不可撤销。
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-10 items-center rounded border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex h-10 items-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50"
          >
            {pending ? "处理中…" : "确认停用"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create-link inline form
// ---------------------------------------------------------------------------

function CreateLinkForm({
  surveyId,
  onCreated,
}: {
  surveyId: string;
  onCreated: (link: InterviewLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single_use" | "reusable">("single_use");
  const [maxUses, setMaxUses] = useState(10);
  const [expiresAt, setExpiresAt] = useState("");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expiresAt) return;
    startTransition(async () => {
      const link = await createInterviewLink(surveyId, {
        mode,
        maxUses: mode === "single_use" ? 1 : maxUses,
        expiresAt: new Date(expiresAt).toISOString(),
        label: label.trim() || undefined,
      });
      onCreated(link);
      setOpen(false);
      setLabel("");
      setExpiresAt("");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
      >
        新建链接
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 rounded-lg border border-ink-200 bg-ink-0 p-4">
      <p className="mb-3 font-ui text-body-sm font-semibold text-ink-900">新建访谈链接</p>

      {/* Mode */}
      <div className="mb-3">
        <p className="mb-1 font-ui text-body-sm text-ink-600">使用模式</p>
        <div className="flex gap-4">
          {(["single_use", "reusable"] as const).map((m) => (
            <label
              key={m}
              className="flex cursor-pointer items-center gap-2 font-ui text-body-sm text-ink-900"
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-ink-900"
              />
              {MODE_LABELS[m]}
            </label>
          ))}
        </div>
      </div>

      {/* maxUses — only for reusable */}
      {mode === "reusable" && (
        <div className="mb-3">
          <label className="mb-1 block font-ui text-body-sm text-ink-600" htmlFor="maxUsesField">
            最多使用次数
          </label>
          <input
            id="maxUsesField"
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
            className="w-24 rounded border border-ink-200 bg-ink-0 px-3 py-1.5 font-ui text-body-sm text-ink-900 outline-none focus:border-ink-400"
          />
        </div>
      )}

      {/* expiresAt */}
      <div className="mb-3">
        <label className="mb-1 block font-ui text-body-sm text-ink-600" htmlFor="expiresAtField">
          有效期至 <span className="text-ink-900">*</span>
        </label>
        <input
          id="expiresAtField"
          type="date"
          required
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="rounded border border-ink-200 bg-ink-0 px-3 py-1.5 font-ui text-body-sm text-ink-900 outline-none focus:border-ink-400"
        />
      </div>

      {/* label */}
      <div className="mb-4">
        <label className="mb-1 block font-ui text-body-sm text-ink-600" htmlFor="linkLabelField">
          备注标签（可选）
        </label>
        <input
          id="linkLabelField"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="如：社交媒体渠道"
          className="w-full rounded border border-ink-200 bg-ink-0 px-3 py-1.5 font-ui text-body-sm text-ink-900 outline-none placeholder:text-ink-400 focus:border-ink-400"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !expiresAt}
          className="inline-flex h-9 items-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50"
        >
          {pending ? "创建中…" : "创建"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-9 items-center rounded border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50"
        >
          取消
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Link row
// ---------------------------------------------------------------------------

function LinkRow({
  link,
  onRevoked,
}: {
  link: InterviewLink;
  onRevoked: (id: string) => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/interview?link=${link.token}`
      : `/interview?link=${link.token}`;

  function handleRevoke() {
    startTransition(async () => {
      await revokeInterviewLink(link.$id);
      onRevoked(link.$id);
      setShowConfirm(false);
    });
  }

  return (
    <>
      <div
        className={`flex items-center gap-3 rounded border px-3 py-2.5 ${
          link.isRevoked ? "border-ink-100 bg-ink-100 opacity-60" : "border-ink-200 bg-mauve-50"
        }`}
      >
        {/* Token prefix */}
        <span className="w-20 shrink-0 font-data text-body-sm text-ink-600">
          {link.token.slice(0, 8)}…
        </span>

        {/* Label */}
        <span className="min-w-0 flex-1 truncate font-ui text-body-sm text-ink-900">
          {link.label ?? <span className="text-ink-400">无标签</span>}
        </span>

        {/* Mode */}
        <span className="shrink-0 font-data text-body-sm text-ink-600">
          {MODE_LABELS[link.mode]}
        </span>

        {/* Uses */}
        <span className="w-16 shrink-0 text-right font-data text-body-sm text-ink-600">
          {link.usedCount}/{link.mode === "single_use" ? 1 : link.maxUses}
        </span>

        {/* ExpiresAt */}
        <span className="w-24 shrink-0 text-right font-data text-body-sm text-ink-600">
          {link.expiresAt.slice(0, 10)}
        </span>

        {/* Revoked badge */}
        {link.isRevoked && (
          <span className="inline-flex shrink-0 items-center gap-1 font-decor text-body-sm text-ink-400">
            <PauseCircle className="size-3.5" strokeWidth={2} />
            已停用
          </span>
        )}

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {!link.isRevoked && <CopyButton value={shareUrl} />}
          {!link.isRevoked && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="font-ui text-body-sm text-ink-400 underline transition-colors hover:text-ink-900"
            >
              停用
            </button>
          )}
        </div>
      </div>

      <ConfirmRevokeDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleRevoke}
        pending={pending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function RecruitView({
  surveyId,
  initialLinks,
  testLink,
}: {
  surveyId: string;
  initialLinks: InterviewLink[];
  testLink: InterviewLink | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>("link");
  const [links, setLinks] = useState<InterviewLink[]>(initialLinks);

  function handleLinkCreated(link: InterviewLink) {
    setLinks((prev) => [link, ...prev]);
  }

  function handleLinkRevoked(id: string) {
    setLinks((prev) => prev.map((l) => (l.$id === id ? { ...l, isRevoked: true } : l)));
  }

  const testUrl = testLink
    ? typeof window !== "undefined"
      ? `${window.location.origin}/interview?link=${testLink.token}`
      : `/interview?link=${testLink.token}`
    : null;

  return (
    <div className="h-full min-h-0 overflow-y-auto px-7 py-6">
      {/* Tab cards */}
      <div className="mb-6 flex max-w-2xl gap-3">
        {CARDS.map((card) => {
          const active = choice === card.id;
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setChoice(card.id)}
              aria-pressed={active}
              className={`flex-1 rounded-lg border bg-ink-0 p-4 text-left transition-colors ${
                active ? "border-ink-900" : "border-ink-200 hover:bg-mauve-50"
              }`}
            >
              <Icon className="mb-2 size-[18px] text-ink-900" strokeWidth={2} />
              <div className="font-ui text-body-sm font-semibold text-ink-900">{card.title}</div>
              <p className="mt-1 font-ui text-body-sm leading-6 text-ink-400">{card.desc}</p>
            </button>
          );
        })}
      </div>

      {/* 分享链接 tab */}
      {choice === "link" && (
        <div className="max-w-2xl">
          <div className="mb-4">
            <SectionTitle>访谈链接</SectionTitle>
            <p className="mb-3 font-ui text-body-sm text-ink-400">
              创建匿名访谈链接，发给受访者即可参与。
            </p>
            <CreateLinkForm surveyId={surveyId} onCreated={handleLinkCreated} />
          </div>

          {links.length > 0 && (
            <>
              {/* Column headers */}
              <div className="mb-1 flex items-center gap-3 px-3">
                <span className="w-20 shrink-0 font-ui text-caption text-ink-400">Token</span>
                <span className="min-w-0 flex-1 font-ui text-caption text-ink-400">标签</span>
                <span className="shrink-0 font-ui text-caption text-ink-400">模式</span>
                <span className="w-16 shrink-0 text-right font-ui text-caption text-ink-400">用量</span>
                <span className="w-24 shrink-0 text-right font-ui text-caption text-ink-400">到期</span>
                <span className="w-16 shrink-0" />
              </div>
              <div className="flex flex-col gap-1.5">
                {links.map((link) => (
                  <LinkRow key={link.$id} link={link} onRevoked={handleLinkRevoked} />
                ))}
              </div>
            </>
          )}

          {links.length === 0 && (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-ink-200 px-6 py-12">
              <p className="font-ui text-body-sm text-ink-400">
                暂无访谈链接，点击「新建链接」创建第一条。
              </p>
            </div>
          )}
        </div>
      )}

      {/* 测试访谈 tab */}
      {choice === "test" && (
        <div className="max-w-xl">
          <SectionTitle>测试访谈</SectionTitle>
          <p className="mb-2.5 font-ui text-body-sm text-ink-400">
            正式招募前，用以下链接自己先体验一遍访谈。
          </p>
          {testUrl ? (
            <>
              <div className="flex items-center gap-2 rounded border border-ink-200 bg-mauve-50 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-data text-body-sm text-ink-600">
                  {testUrl}
                </span>
                <CopyButton value={testUrl} />
              </div>
              <a
                href={testUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex h-9 items-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
              >
                开始测试访谈
              </a>
            </>
          ) : (
            <div className="rounded border border-dashed border-ink-200 px-4 py-6 text-center">
              <p className="font-ui text-body-sm text-ink-600">无法创建测试链接</p>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50"
              >
                <RefreshCw className="size-3.5" strokeWidth={2} />
                重试
              </button>
            </div>
          )}
        </div>
      )}

      {/* 外部渠道 tab */}
      {choice === "external" && (
        <div className="grid max-w-xl place-items-center rounded-lg border border-dashed border-ink-200 px-6 py-12 text-center">
          <Globe className="mb-3 size-7 text-ink-400" strokeWidth={1.5} />
          <p className="font-display text-display-md text-ink-900">敬请期待</p>
          <p className="mt-1 font-ui text-body-sm text-ink-400">外部受访渠道对接正在规划中。</p>
        </div>
      )}
    </div>
  );
}
