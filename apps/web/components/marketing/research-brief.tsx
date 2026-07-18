import { Check, FileText, MicVocal, ScanSearch } from "lucide-react";

const briefLines = [
  "研究对象、场景与关键决策",
  "每一段对话要回答的问题",
  "允许追问的边界与访谈语气",
] as const;

const outcomes = [
  { icon: FileText, label: "结构化研究说明" },
  { icon: MicVocal, label: "有上下文的对话" },
  { icon: ScanSearch, label: "可检索的原始证据" },
] as const;

export function ResearchBrief() {
  return (
    <section id="brief" className="border-b border-ink-200 bg-mauve-50">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16 lg:px-8">
        <div className="max-w-xl">
          <p className="font-ui text-caption font-medium uppercase text-ink-600">A research brief, not a prompt</p>
          <h2 className="mt-3 font-display text-display-xl font-semibold text-ink-900 sm:text-4xl">
            先建立一份能指导真实对话的研究说明。
          </h2>
          <p className="mt-5 font-reading text-body-lg leading-8 text-ink-600">
            Merism 将研究意图沉淀为访谈大纲，而不是把一次访谈交给一段不可追溯的提示词。每个问题、分段与追问边界都保持清楚。
          </p>

          <ul className="mt-8 space-y-3" aria-label="研究说明的内容">
            {outcomes.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 font-ui text-body-sm text-ink-800">
                <span className="flex size-8 shrink-0 items-center justify-center rounded border border-ink-200 bg-ink-0">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl bg-mauve-200 p-4 shadow-sm sm:p-6">
          <article className="rounded-lg bg-ink-0 p-5 shadow-sm sm:p-6" aria-label="研究说明示例">
            <div className="flex items-center justify-between gap-4 border-b border-ink-200 pb-4">
              <div>
                <p className="font-ui text-caption text-ink-400">研究说明</p>
                <p className="mt-1 font-display text-display-md font-semibold text-ink-900">协作工具使用体验</p>
              </div>
              <span className="rounded-xs bg-mauve-50 px-2 py-1 font-decor text-caption text-ink-600">已整理</span>
            </div>

            <div className="mt-5 rounded-md border border-ink-200 p-4">
              <p className="font-ui text-caption text-ink-400">这次研究想理解</p>
              <p className="mt-2 font-reading text-body text-ink-800">
                团队在跨工具协作时，何时感到信息断裂，又如何临时补救。
              </p>
            </div>

            <ul className="mt-5 space-y-3">
              {briefLines.map((line) => (
                <li key={line} className="flex gap-3 font-ui text-body-sm text-ink-600">
                  <Check className="mt-0.5 size-4 shrink-0 text-ink-900" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
