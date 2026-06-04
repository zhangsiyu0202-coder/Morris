import { FileText, Search, BarChart3, Layers } from "lucide-react";
import { Conversation } from "@/components/assistant/conversation";

const CAPABILITIES = [
  { icon: FileText, title: "创建调研", desc: "描述目标,生成可用的问题草稿" },
  { icon: Search, title: "检索数据", desc: "在访谈记录中查找受访者原话" },
  { icon: BarChart3, title: "分析结果", desc: "聚合统计与高频主题洞察" },
  { icon: Layers, title: "管理调研", desc: "查看进行中与历史调研" },
];

const SUGGESTIONS = [
  "帮我创建一份关于移动端结账体验的调研",
  "受访者对搜索筛选有什么抱怨?",
  "分析差旅住宿调研的结果",
  "列出我当前的所有调研",
];

export default function AssistantPage() {
  return (
    <div className="flex h-full bg-mauve-50">
      <aside className="hidden w-80 shrink-0 flex-col border-r border-mauve-200 bg-ink-0 p-6 lg:flex">
        <h1 className="font-display text-display-lg text-ink-900">研究助手</h1>
        <p className="mt-2 font-ui text-body-sm leading-6 text-ink-400">
          由 DeepSeek 驱动的 AI 研究伙伴,贯穿调研创建、数据检索到结果分析的全流程。
        </p>
        <div className="mt-8 flex flex-col gap-3">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="flex gap-3 rounded-md border border-mauve-100 bg-mauve-50 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-ink-0 text-ink-600 shadow-xs">
                <c.icon size={18} />
              </span>
              <div>
                <p className="font-ui text-body-sm font-medium text-ink-800">{c.title}</p>
                <p className="font-ui text-caption leading-4 text-ink-400">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-auto font-ui text-caption text-ink-400">
          数据为演示用途,正式分析能力接入后将连接真实访谈记录。
        </p>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <Conversation suggestions={SUGGESTIONS} />
      </section>
    </div>
  );
}
