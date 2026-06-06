"use client";

import { useState } from "react";
import { Link2, Bot, Globe, Copy, Check } from "lucide-react";
import type { RecruitMock } from "@/lib/mock/workspace";

/**
 * 招募视图(mock,范围安全)。
 *
 * 仅提供匿名访谈链接、完成跳转 URL 与自测入口 —— 对应本产品的真实模型
 * (匿名链接 token / issueLivekitToken)。刻意不包含任何计费、配额、
 * 第三方招募面板等概念(见 AGENTS.md 永久排除项)。
 */

type Choice = "link" | "test" | "external";

const CARDS: { id: Choice; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; title: string; desc: string }[] = [
  { id: "link", icon: Link2, title: "分享链接", desc: "通过匿名链接邀请受访者参与访谈。" },
  { id: "test", icon: Bot, title: "测试访谈", desc: "在正式招募前,自己先体验一遍访谈流程。" },
  { id: "external", icon: Globe, title: "外部渠道", desc: "对接外部受访渠道。敬请期待。" },
];

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2 rounded border border-ink-200 bg-mauve-50 px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-data text-caption text-ink-600">{value}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="复制链接"
        className="grid size-6 shrink-0 place-items-center rounded text-ink-400 transition-colors hover:bg-mauve-100 hover:text-ink-900"
      >
        {copied ? <Check className="size-3.5" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={2} />}
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 font-ui text-body-sm font-semibold text-ink-900">{children}</h2>;
}

export function RecruitView({ recruit }: { recruit: RecruitMock }) {
  const [choice, setChoice] = useState<Choice>("link");
  const [completionUrl, setCompletionUrl] = useState(recruit.completionUrl);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-7 py-6">
      {/* 选项卡片 */}
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
              <p className="mt-1 font-ui text-caption leading-5 text-ink-400">{card.desc}</p>
            </button>
          );
        })}
      </div>

      {/* 动态内容 */}
      {choice === "link" && (
        <div className="max-w-xl">
          <div className="mb-6">
            <SectionTitle>可分享链接</SectionTitle>
            <p className="mb-2.5 font-ui text-caption text-ink-400">
              把以下匿名链接发给受访者即可参与访谈。
            </p>
            <CopyField value={recruit.shareableUrl} />
          </div>

          <div className="h-px bg-ink-100" />

          <div className="mt-6">
            <SectionTitle>完成后跳转 URL</SectionTitle>
            <p className="mb-2.5 font-ui text-caption text-ink-400">
              填写一个 URL,受访者完成访谈后将自动跳转到该地址。
            </p>
            <input
              type="url"
              value={completionUrl}
              onChange={(e) => setCompletionUrl(e.target.value)}
              placeholder="https://"
              className="mb-3 w-full rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
            />
            <button
              type="button"
              className="inline-flex h-9 items-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
            >
              保存跳转 URL
            </button>
          </div>
        </div>
      )}

      {choice === "test" && (
        <div className="max-w-xl">
          <SectionTitle>测试访谈</SectionTitle>
          <p className="mb-2.5 font-ui text-caption text-ink-400">
            正式招募前,用以下链接自己先体验一遍访谈。
          </p>
          <CopyField value={recruit.testUrl} />
          <button
            type="button"
            className="mt-4 inline-flex h-9 items-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
          >
            开始测试访谈
          </button>
        </div>
      )}

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
