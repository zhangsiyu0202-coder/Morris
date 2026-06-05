import { SoftInput } from "@/components/demo/soft-input";

export default function DemoPage() {
  return (
    <main className="min-h-full bg-mauve-50 px-8 py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10">
          <h1 className="font-ui text-3xl font-semibold text-ink-800">示例输入框</h1>
          <p className="mt-2 max-w-xl font-reading text-body leading-7 text-ink-600">
            复刻 Accordion 卡片的视觉格式:大圆角与柔和的莫兰迪阴影,白底极简、无硬边框。
          </p>
        </header>
        <SoftInput />
      </div>
    </main>
  );
}
