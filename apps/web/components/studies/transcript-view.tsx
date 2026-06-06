import Link from "next/link";
import { ArrowLeft, Bookmark } from "lucide-react";
import type { TranscriptDetail } from "@/lib/mock/workspace";

/**
 * 转录下钻:左侧逐条对话(主持人/受访者),右侧 AI 摘要 + 书签 + 元数据。
 * 说话人用 font-decor 标签 pill,对话正文用 font-reading(长文阅读体)。
 */

const SPEAKER_LABEL: Record<TranscriptDetail["turns"][number]["speaker"], string> = {
  interviewer: "主持人",
  respondent: "受访者",
};

export function TranscriptView({
  studyId,
  transcript,
}: {
  studyId: string;
  transcript: TranscriptDetail;
}) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* 左:转录 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-ink-200 px-7 py-6">
        <Link
          href={`/studies/${studyId}/results`}
          className="mb-4 inline-flex items-center gap-1.5 self-start font-ui text-caption text-ink-400 transition-colors hover:text-ink-600"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          返回结果
        </Link>

        <div className="mb-5">
          <h1 className="font-display text-display-lg text-ink-900">访谈转录</h1>
          <p className="mt-1 font-data text-caption text-ink-400">
            {transcript.datetime} · {transcript.language}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          {transcript.turns.map((turn, i) => (
            <div key={i}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="rounded-full bg-mauve-100 px-2 py-0.5 font-decor text-caption text-ink-900">
                  {SPEAKER_LABEL[turn.speaker]}
                </span>
                {turn.questionTag && (
                  <span className="rounded-full bg-mauve-50 px-2 py-0.5 font-decor text-caption text-ink-600">
                    {turn.questionTag}
                  </span>
                )}
              </div>
              <p className="font-reading text-body leading-7 text-ink-800">{turn.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 右:摘要 + 书签 + 元数据 */}
      <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto px-5 py-6">
        <section>
          <h2 className="mb-2.5 font-ui text-body-sm font-semibold text-ink-900">AI 摘要</h2>
          <p className="mb-3 font-reading text-body-sm leading-7 text-ink-600">
            {transcript.aiSummary}
          </p>
          <button
            type="button"
            className="w-full rounded border border-ink-900 bg-ink-0 px-3 py-2 font-ui text-caption font-medium text-ink-900 transition-colors hover:bg-mauve-50"
          >
            申请访谈录音
          </button>
        </section>

        <div className="h-px bg-ink-100" />

        <section>
          <div className="mb-3 flex items-center gap-1.5">
            <Bookmark className="size-3.5 text-ink-400" strokeWidth={2} />
            <h2 className="font-ui text-body-sm font-semibold text-ink-900">已存书签</h2>
          </div>
          <p className="font-ui text-caption text-ink-400">尚未保存任何书签。</p>
        </section>

        <div className="h-px bg-ink-100" />

        <section>
          <h2 className="mb-2.5 font-ui text-body-sm font-semibold text-ink-900">元数据</h2>
          <div className="flex flex-col gap-2.5">
            {transcript.metadata.map(({ key, value }) => (
              <div key={key}>
                <div className="font-ui text-caption text-ink-400">{key}</div>
                <div className="break-all font-data text-caption text-ink-600">{value}</div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
