import { AudioLines, Quote } from "lucide-react";

export function ProductCanvas() {
  return (
    <section className="rounded-xl bg-mauve-200 p-4 shadow-md sm:p-6" aria-labelledby="product-canvas-title">
      <h2 id="product-canvas-title" className="sr-only">Merism 产品工作流预览</h2>
      <div className="rounded-lg bg-ink-0 p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-ink-200 pb-5">
          <div>
            <p className="font-ui text-caption text-ink-400">研究项目</p>
            <p className="mt-1 font-display text-display-lg font-semibold text-ink-900">协作工具使用体验</p>
          </div>
          <span className="rounded-xs bg-mauve-50 px-2 py-1 font-decor text-caption text-ink-600">进行中</span>
        </div>

        <div className="grid gap-3 py-5 sm:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-md bg-mauve-50 p-4">
            <p className="font-ui text-caption text-ink-600">下一场访谈</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full border border-ink-900 bg-ink-0">
                <AudioLines className="size-4" aria-hidden="true" />
              </div>
              <div>
                <p className="font-ui text-body-sm font-medium text-ink-900">匿名受访者</p>
                <p className="font-ui text-caption text-ink-600">AI 访谈员已就绪</p>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-ink-200 p-4">
            <p className="font-ui text-caption text-ink-400">访谈线索</p>
            <p className="mt-3 font-reading text-body-sm text-ink-800">“工具很多，但我并不总知道下一步该找谁。”</p>
            <div className="mt-4 flex items-center gap-2 font-ui text-caption text-ink-600">
              <Quote className="size-3.5" aria-hidden="true" />
              原始引文，可回看
            </div>
          </div>
        </div>

        <div className="border-t border-ink-200 pt-5">
          <div className="flex items-center justify-between gap-4">
            <p className="font-ui text-caption text-ink-400">正在形成的主题</p>
            <p className="font-data text-caption text-ink-600">03</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-xs border border-ink-200 bg-ink-0 px-2.5 py-1 font-ui text-caption text-ink-600">内部协作断点</span>
            <span className="rounded-xs border border-ink-200 bg-ink-0 px-2.5 py-1 font-ui text-caption text-ink-600">工具切换成本</span>
            <span className="rounded-xs border border-ink-200 bg-ink-0 px-2.5 py-1 font-ui text-caption text-ink-600">责任归属</span>
          </div>
        </div>
      </div>
    </section>
  );
}
