import Link from "next/link";
import { FileText, Search, BarChart3, Layers, ArrowRight, AlertTriangle, NotebookText, Check } from "lucide-react";
import { SentimentTag } from "@/components/report/shared";
import { UNKNOWN_TOOL_METADATA, type ToolMetadata } from "./tool-metadata";
import { TOOL_CATALOG, toolEnrichLabel, type ToolName } from "./tool-catalog";

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

type DraftQuestion = { questionText: string; questionType: string; probeLevel?: string; stimulus?: unknown };
type DraftSection = { title: string; objective: string; questions: DraftQuestion[] };
type SurveyDraftShape = {
  title: string;
  researchGoal: string;
  targetAudience: string;
  sections: DraftSection[];
};
type CreateStudyResult =
  | { persisted: false; draft: SurveyDraftShape; note: string }
  | {
      persisted: true;
      surveyId: string;
      url: string;
      title: string;
      sectionCount: number;
      questionCount: number;
    };

function DraftOutline({ draft }: { draft: SurveyDraftShape }) {
  return (
    <ol className="mt-3 flex flex-col gap-3">
      {draft.sections.map((s, i) => (
        <li key={i}>
          <p className="font-ui text-body-sm font-medium text-ink-800">
            {i + 1}. {s.title}
          </p>
          {s.objective && <p className="font-ui text-caption text-ink-400">{s.objective}</p>}
          <ul className="mt-1 flex flex-col gap-1 pl-3">
            {s.questions.map((q, j) => (
              <li key={j} className="font-reading text-body-sm leading-6 text-ink-700">
                {j + 1}. {q.questionText}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function CreateStudyResultCard({ data }: { data: CreateStudyResult }) {
  if (data.persisted) {
    return (
      <ToolCard icon={<Check size={14} />} title="调研已创建">
        <h4 className="font-display text-body-lg text-ink-900">{data.title}</h4>
        <p className="mt-1 font-ui text-body-sm text-ink-500">
          已保存 {data.sectionCount} 节 · {data.questionCount} 个问题
        </p>
        <Link
          href={data.url}
          className="mt-3 inline-flex items-center gap-1.5 rounded bg-mauve-200 px-3 py-1.5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
        >
          打开调研 <ArrowRight size={13} />
        </Link>
      </ToolCard>
    );
  }
  return (
    <ToolCard icon={<FileText size={14} />} title="调研草稿(预览)">
      <h4 className="font-display text-body-lg text-ink-900">{data.draft.title}</h4>
      <p className="mt-1 font-ui text-body-sm text-ink-600">{data.draft.researchGoal}</p>
      <div className="mt-2 inline-flex items-center rounded-full bg-mauve-100 px-2 py-0.5 font-ui text-caption text-ink-600">
        受访人群:{data.draft.targetAudience}
      </div>
      <DraftOutline draft={data.draft} />
      <p className="mt-3 font-ui text-caption text-ink-400">{data.note}</p>
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

function SearchResultCard({ data }: { data: SearchResult }) {
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

function AnalysisCard({ data }: { data: Analysis }) {
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
  studies: {
    id: string;
    title: string;
    status: string;
    version: number;
    updatedAt: string;
  }[];
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  published: "进行中",
  paused: "已暂停",
  closed: "已结束",
  archived: "已归档",
};

function formatStudyDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export function StudyListCard({ data }: { data: StudyList }) {
  return (
    <ToolCard icon={<Layers size={14} />} title="调研列表">
      <ul className="flex flex-col divide-y divide-mauve-100">
        {data.studies.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate font-ui text-body-sm font-medium text-ink-800">{s.title}</p>
              <p className="font-ui text-caption text-ink-400">
                v{s.version} · 更新于 {formatStudyDate(s.updatedAt)}
              </p>
            </div>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 font-ui text-caption font-medium"
              style={{
                color: s.status === "published" ? "var(--color-positive)" : "var(--color-ink-400)",
                backgroundColor:
                  s.status === "published"
                    ? "color-mix(in oklab, var(--color-positive) 14%, transparent)"
                    : "var(--color-mauve-100)",
              }}
            >
              {STATUS_LABEL[s.status] ?? s.status}
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

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function renderToolResult({
  toolName,
  output,
  metadata = UNKNOWN_TOOL_METADATA,
}: {
  toolName: string;
  output: unknown;
  metadata?: ToolMetadata;
}) {
  const artifact = unwrapToolOutput(output);

  if (artifact && typeof artifact === "object" && (artifact as { error?: boolean }).error === true) {
    const message = (artifact as { message?: string }).message ?? "该操作未能完成,请重试。";
    return <ToolErrorCard message={message} />;
  }

  let card: React.ReactNode = null;
  switch (toolName) {
    case "createStudyDraft":
      card = <CreateStudyResultCard data={artifact as CreateStudyResult} />;
      break;
    case "searchInterviewData":
      card = <SearchResultCard data={artifact as SearchResult} />;
      break;
    case "analyzeData":
      card = <AnalysisCard data={artifact as Analysis} />;
      break;
    case "listStudies":
      card = <StudyListCard data={artifact as StudyList} />;
      break;
    case "createNotebook":
      card = <NotebookCreatedCard data={artifact as NotebookCreated} />;
      break;
    default:
      card = null;
  }

  const enrich = metadata.enrichUrl ? (
    <EnrichLinkRow
      template={metadata.enrichUrl}
      artifact={artifact}
      label={toolName in TOOL_CATALOG ? toolEnrichLabel(toolName as ToolName) : "查看"}
      toolName={toolName}
    />
  ) : null;

  if (!card && !enrich) return null;
  return (
    <>
      {card}
      {enrich}
    </>
  );
}

export function EnrichLinkRow({
  template,
  artifact,
  label = "查看",
  toolName: _toolName,
}: {
  template: string;
  artifact: unknown;
  label?: string;
  toolName: string;
}) {
  if (!artifact || typeof artifact !== "object") return null;
  const map = artifact as Record<string, unknown>;
  let missing: string | null = null;
  const href = template.replace(PLACEHOLDER_RE, (_, key) => {
    const v = map[key];
    if (v === undefined || v === null || v === "") {
      missing = key;
      return "";
    }
    return encodeURIComponent(String(v));
  });
  if (missing) {
    return null;
  }
  return (
    <Link
      href={href}
      className="mt-3 inline-flex items-center gap-1.5 rounded bg-mauve-200 px-3 py-1.5 font-ui text-body-sm font-medium text-ink-900 transition-opacity hover:bg-mauve-100"
    >
      {label} <ArrowRight size={13} />
    </Link>
  );
}

type NotebookCreated = {
  notebookShortId: string;
  $id: string;
  studyId: string;
  question: string;
  sectionCount: number;
  status: "created";
};

function NotebookCreatedCard({ data }: { data: NotebookCreated }) {
  if (!data?.notebookShortId) {
    return (
      <ToolCard icon={<NotebookText size={14} />} title="Notebook 草稿">
        <p className="font-ui text-body-sm text-ink-600">
          已记录草稿 (未落库)。继续完善后再保存为正式 Notebook。
        </p>
      </ToolCard>
    );
  }
  return (
    <ToolCard icon={<NotebookText size={14} />} title="Notebook 已创建">
      <h4 className="font-display text-body-lg text-ink-900">{data.question}</h4>
      <p className="mt-1 font-ui text-body-sm text-ink-500">
        含 {data.sectionCount} 个章节 · shortId {data.notebookShortId}
      </p>
    </ToolCard>
  );
}
