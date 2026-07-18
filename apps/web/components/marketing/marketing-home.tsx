import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  ClipboardPenLine,
  FileSearch,
  Sparkles,
} from "lucide-react";
import { ProductCanvas } from "./product-canvas";

const focusRingClass =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900";

const workflow = [
  {
    icon: ClipboardPenLine,
    number: "01",
    title: "设计研究",
    description: "将研究背景、访谈目标和问题组织成一份可执行的访谈大纲。",
  },
  {
    icon: AudioLines,
    number: "02",
    title: "进行访谈",
    description: "受访者通过匿名链接加入，由 AI 访谈员自然追问并记录上下文。",
  },
  {
    icon: FileSearch,
    number: "03",
    title: "理解证据",
    description: "回看原始引文、访谈记录和结构化分析，形成可追溯的研究判断。",
  },
] as const;

export function MarketingHome() {
  return (
    <div className="min-h-dvh overflow-hidden bg-mauve-50 text-ink-900">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/" className={`font-decor text-display-md text-ink-900 ${focusRingClass}`} aria-label="Merism 首页">
          Merism
        </Link>

        <nav className="hidden items-center gap-6 font-ui text-body-sm text-ink-600 md:flex" aria-label="产品导航">
          <a className={`transition-colors hover:text-ink-900 ${focusRingClass}`} href="#workflow">
            工作方式
          </a>
          <a className={`transition-colors hover:text-ink-900 ${focusRingClass}`} href="#product">
            产品体验
          </a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className={`inline-flex h-10 items-center justify-center rounded px-3 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 sm:px-4 ${focusRingClass}`}
          >
            登录
          </Link>
          <Link
            href="/signup"
            className={`inline-flex h-10 items-center justify-center rounded border border-ink-900 bg-ink-0 px-3 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50 sm:px-4 ${focusRingClass}`}
          >
            注册
          </Link>
        </div>
      </header>

      <main>
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-16 lg:px-8 lg:pb-32">
        <div className="max-w-2xl">
          <p className="font-ui text-caption font-medium uppercase text-ink-600">
            AI qualitative research
          </p>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
            让每一次访谈，
            <span className="block">留下可用的证据。</span>
          </h1>
          <p className="mt-6 max-w-xl font-reading text-body-lg leading-8 text-ink-600">
            Merism 将研究设计、匿名 AI 访谈与证据回看放在一条连贯的工作流中，帮助研究者更专注于理解人，而不是整理记录。
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/home"
              className={`inline-flex h-10 items-center justify-center gap-2 rounded bg-mauve-200 px-5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 ${focusRingClass}`}
            >
              进入产品
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a
              href="#workflow"
              className={`inline-flex h-10 items-center justify-center gap-2 rounded border border-ink-900 bg-ink-0 px-5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50 ${focusRingClass}`}
            >
              了解工作方式
              <ArrowDown className="size-4" aria-hidden="true" />
            </a>
          </div>

          <p className="mt-5 font-ui text-caption text-ink-600">已有账户可直接进入工作区；新研究者可先注册。</p>
        </div>

        <ProductCanvas />
      </section>

      <section id="workflow" className="border-y border-ink-200 bg-ink-0">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="max-w-2xl">
            <p className="font-ui text-caption font-medium uppercase text-ink-600">Research, in sequence</p>
            <h2 className="mt-3 font-display text-display-xl font-semibold text-ink-900 sm:text-4xl">
              从研究意图，到真实对话，再到清晰判断。
            </h2>
          </div>

          <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-0" aria-label="Merism 工作流程">
            {workflow.map(({ icon: Icon, number, title, description }, index) => (
              <li
                key={number}
                className="border-ink-200 md:px-8 md:first:pl-0 md:not-last:border-r md:last:pr-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-data text-body-sm text-ink-400">{number}</span>
                  <Icon className="size-5 text-ink-900" aria-hidden="true" />
                </div>
                <h3 className="mt-10 font-display text-display-lg font-semibold text-ink-900">{title}</h3>
                <p className="mt-3 max-w-sm font-reading text-body text-ink-600">{description}</p>
                {index < workflow.length - 1 ? <div className="mt-8 h-px bg-ink-200 md:hidden" /> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="product" className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="rounded-xl bg-mauve-200 px-6 py-10 shadow-sm sm:px-10 sm:py-12 lg:flex lg:items-end lg:justify-between lg:gap-12">
          <div className="max-w-2xl">
            <Sparkles className="size-5 text-ink-900" aria-hidden="true" />
            <h2 className="mt-6 font-display text-display-xl font-semibold text-ink-900 sm:text-4xl">
              研究结论，不该脱离原始对话。
            </h2>
            <p className="mt-4 font-reading text-body-lg text-ink-800">
              从一个问题开始，建立能够回到原话、看见分歧并持续深化的研究过程。
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row lg:mt-0">
            <Link
              href="/home"
              className={`inline-flex h-10 items-center justify-center gap-2 rounded border border-ink-900 bg-ink-0 px-5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50 ${focusRingClass}`}
            >
              进入产品
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/signup"
              className={`inline-flex h-10 items-center justify-center rounded border border-ink-900 bg-ink-0 px-5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50 ${focusRingClass}`}
            >
              创建账户
            </Link>
          </div>
        </div>
      </section>
      </main>
    </div>
  );
}
