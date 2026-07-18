import { ArrowRight, Quote } from "lucide-react";

export function EvidenceStory() {
  return (
    <section id="evidence" className="bg-ink-0">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-ui text-caption font-medium uppercase text-ink-600">Evidence stays attached</p>
          <h2 className="mt-3 font-display text-display-xl font-semibold text-ink-900 sm:text-4xl">
            每一条判断，都能回到证据。
          </h2>
          <p className="mt-5 font-reading text-body-lg leading-8 text-ink-600">
            主题、洞察与建议不是脱离语境的结论。它们始终可以回到受访者原话、对应访谈与形成它的研究问题。
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:gap-6">
          <article className="rounded-xl bg-mauve-200 p-6 shadow-sm sm:p-8">
            <p className="font-ui text-caption text-ink-600">一个正在形成的主题</p>
            <h3 className="mt-4 max-w-xl font-display text-display-lg font-semibold text-ink-900 sm:text-display-xl">
              工具越多，协作的责任边界反而越模糊。
            </h3>
            <div className="mt-8 flex items-center gap-3 font-ui text-body-sm text-ink-800">
              <span className="flex size-8 items-center justify-center rounded-full border border-ink-900 bg-ink-0">03</span>
              来自 3 场独立访谈的直接证据
            </div>
          </article>

          <article className="rounded-xl border border-ink-200 bg-ink-0 p-6 shadow-sm sm:p-8">
            <Quote className="size-5 text-ink-900" aria-hidden="true" />
            <p className="mt-5 font-reading text-body leading-7 text-ink-800">
              “我们总在补充工具，但真正卡住的时候，还是没人知道下一步该由谁接手。”
            </p>
            <div className="mt-8 flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
              <p className="font-ui text-caption text-ink-600">匿名受访者 · 原始访谈记录</p>
              <ArrowRight className="size-4 shrink-0 text-ink-900" aria-hidden="true" />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
