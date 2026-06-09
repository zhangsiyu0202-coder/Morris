import { FileText, Search, BarChart3, Layers, ArrowRight, AlertTriangle } from "lucide-react";
import { SentimentTag } from "@/components/report/shared";

function ToolCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-mauve-200 bg-ink-0 shadow-xs">
      <div className="flex items-center gap-2 border-b border-mauve-100 bg-mauve-50 px-3 py-2">
        <span className="text-ink-400">{icon}</span>
        <span className="font-ui text-caption font-medium uppercase tracking-wide text-ink-400">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

type StudyDraft = {
  title: string;
  goal: string;
  audience: string;
  questions: { order: number; prompt: string }[];
};

export function StudyDraftCard({ data }: { data: StudyDraft }) {
  return (
    <ToolCard icon={<FileText size={14} />} title="调研草稿">
      <h4 className="font-display text-body-lg text-ink-900">{data.title}</h4>
      <p className="mt-1 font-ui text-body-sm text-ink-600">{data.goal}</p>
      <div className="mt-2 inline-flex items-center rounded-full bg-mauve-100 px-2 py-0.5 font-ui text-caption text-ink-600">
        受访人群:{data.audience}
      </div>
      <ol className="mt-3 flex flex-col gap-2">
        {data.questions.map((q) => (
          <li key={q.order} className="flex gap-2 font-ui text-body-sm text-ink-800">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-800 font-data text-[11px] text-ink-0">
              {q.order}
            </span>
            <span className="leading-6">{q.prompt}</span>
          </li>
        ))}
      </ol>
      <button className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-mauve-200 bg-mauve-50 px-3 py-1.5 font-ui text-body-sm font-medium text-ink-800 transition-colors hover:bg-mauve-100">
        采用此草稿 <ArrowRight size={14} />
      </button>
    </ToolCard>
  );
}

type SearchResult = {
  count: number;
  snippets: {
    studyTitle: string;
    respondent: string;
    questionTitle: string;
    quote: string;
    sentiment: "positive" | "neutral" | "negative";
  }[];
};

export function SearchResultCard({ data }: { data: SearchResult }) {
  return (
    <ToolCard icon={<Search size={14} />} title={`检索到 ${data.count} 条记录`}>
      {data.count === 0 ? (
        <p className="font-ui text-body-sm text-ink-400">没有匹配的访谈片段。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.snippets.map((s, i) => (
            <li key={i} className="border-l-2 border-mauve-200 pl-3">
              <div className="flex items-center gap-2">
                <span className="font-data text-caption text-ink-400">{s.respondent}</span>
                <SentimentTag sentiment={s.sentiment} />
              </div>
              <p className="mt-1 font-reading text-body-sm leading-6 text-ink-800">{`“${s.quote}”`}</p>
              <p className="mt-1 font-ui text-caption text-ink-400">
                {s.studyTitle} · {s.questionTitle}
              </p>
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

type Analysis = {
  studyTitle: string;
  headline: string;
  slices: { metric: string; value: string; detail: string }[];
  themes: { label: string; share: number }[];
};

export function AnalysisCard({ data }: { data: Analysis }) {
  return (
    <ToolCard icon={<BarChart3 size={14} />} title="数据分析">
      <h4 className="font-display text-body-lg text-ink-900">{data.studyTitle}</h4>
      <p className="mt-1 font-reading text-body-sm leading-6 text-ink-600">{data.headline}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {data.slices.map((s) => (
          <div key={s.metric} className="rounded-sm bg-mauve-50 p-2">
            <div className="font-data text-display-md text-ink-900">{s.value}</div>
            <div className="font-ui text-caption font-medium text-ink-600">{s.metric}</div>
            <div className="font-ui text-[11px] leading-4 text-ink-400">{s.detail}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {data.themes.map((t) => (
          <div key={t.label} className="flex items-center gap-2">
            <span className="w-28 shrink-0 font-ui text-caption text-ink-600">{t.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-mauve-100">
              <div className="h-full rounded-full bg-ink-800" style={{ width: `${Math.round(t.share * 100)}%` }} />
            </div>
            <span className="w-9 text-right font-data text-caption text-ink-400">{Math.round(t.share * 100)}%</span>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

type StudyList = {
  studies: { id: string; title: string; status: "draft" | "live" | "closed"; responses: number; completionRate: number }[];
};

const STATUS_LABEL = { draft: "草稿", live: "进行中", closed: "已结束" };

export function StudyListCard({ data }: { data: StudyList }) {
  return (
    <ToolCard icon={<Layers size={14} />} title="调研列表">
      <ul className="flex flex-col divide-y divide-mauve-100">
        {data.studies.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate font-ui text-body-sm font-medium text-ink-800">{s.title}</p>
              <p className="font-ui text-caption text-ink-400">
                {s.responses} 份回答 · 完成率 {Math.round(s.completionRate * 100)}%
              </p>
            </div>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 font-ui text-caption font-medium"
              style={{
                color: s.status === "live" ? "var(--color-positive)" : "var(--color-ink-400)",
                backgroundColor:
                  s.status === "live" ? "color-mix(in oklab, var(--color-positive) 14%, transparent)" : "var(--color-mauve-100)",
              }}
            >
              {STATUS_LABEL[s.status]}
            </span>
          </li>
        ))}
      </ul>
    </ToolCard>
  );
}

function ToolErrorCard({ message }: { message: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-mauve-200 bg-mauve-50 px-3 py-2.5">
      <span className="mt-0.5 shrink-0" style={{ color: "var(--color-negative)" }}>
        <AlertTriangle size={14} />
      </span>
      <div>
        <p className="font-ui text-caption font-medium uppercase tracking-wide text-ink-400">工具执行失败</p>
        <p className="mt-0.5 font-ui text-body-sm leading-6 text-ink-800">{message}</p>
      </div>
    </div>
  );
}

function unwrapToolOutput(output: unknown): unknown {
  if (
    output &&
    typeof output === "object" &&
    "artifact" in output &&
    typeof (output as { artifact?: unknown }).artifact === "object"
  ) {
    return (output as { artifact: unknown }).artifact;
  }
  return output;
}

export function ToolResult({ toolName, output }: { toolName: string; output: unknown }) {
  const artifact = unwrapToolOutput(output);

  // 统一拦截工具失败态:任意工具返回 { error: true, message } 时渲染错误卡。
  if (artifact && typeof artifact === "object" && (artifact as { error?: boolean }).error === true) {
    const message = (artifact as { message?: string }).message ?? "该操作未能完成,请重试。";
    return <ToolErrorCard message={message} />;
  }

  switch (toolName) {
    case "createStudyDraft":
      return <StudyDraftCard data={artifact as StudyDraft} />;
    case "searchInterviewData":
      return <SearchResultCard data={artifact as SearchResult} />;
    case "analyzeData":
      return <AnalysisCard data={artifact as Analysis} />;
    case "listStudies":
      return <StudyListCard data={artifact as StudyList} />;
    default:
      return null;
  }
}
