import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Bookmark } from "@merism/contracts";
import type { TranscriptDetail } from "@/lib/mock/workspace";
import { RecordingDownloadButton } from "@/components/studies/recording-download-button";
import {
  TranscriptBookmarkSidebar,
  TranscriptTurnRow,
} from "@/components/studies/transcript-bookmark-controls";

/**
 * 转录下钻:左侧逐条对话(主持人/受访者),右侧 AI 摘要 + 书签 + 元数据。
 */
export function TranscriptView({
  studyId,
  studyTitle,
  transcript,
  bookmarks,
}: {
  studyId: string;
  studyTitle: string;
  transcript: TranscriptDetail;
  bookmarks: Bookmark[];
}) {
  const savedSegmentIndexes = new Set(
    bookmarks
      .map((bm) => bm.segmentIndex)
      .filter((index): index is number => typeof index === "number"),
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-ink-200 px-7 py-6">
        <Link
          href={`/studies/${studyId}/results`}
          className="mb-4 inline-flex items-center gap-1.5 self-start font-ui text-body-sm text-ink-400 transition-colors hover:text-ink-600"
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
          {transcript.turns.map((turn) => (
            <TranscriptTurnRow
              key={turn.segmentIndex}
              turn={turn}
              studyId={studyId}
              sessionId={transcript.sessionId}
              studyTitle={studyTitle}
              savedSegmentIndexes={savedSegmentIndexes}
            />
          ))}
        </div>
      </div>

      <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto px-5 py-6">
        <section>
          <h2 className="mb-2.5 font-ui text-body-sm font-semibold text-ink-900">AI 摘要</h2>
          <p className="mb-3 font-reading text-body-sm leading-7 text-ink-600">
            {transcript.aiSummary}
          </p>
          {transcript.recording ? (
            <RecordingDownloadButton
              sessionId={transcript.sessionId}
              label="下载录像"
              className="w-full rounded border border-ink-900 bg-ink-0 px-3 py-2 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50"
            />
          ) : (
            <button
              type="button"
              disabled
              aria-disabled
              className="w-full cursor-not-allowed rounded border border-ink-200 bg-ink-100 px-3 py-2 font-ui text-body-sm font-medium text-ink-400"
            >
              暂无录像
            </button>
          )}
        </section>

        <div className="h-px bg-ink-100" />

        <TranscriptBookmarkSidebar bookmarks={bookmarks} />

        <div className="h-px bg-ink-100" />

        <section>
          <h2 className="mb-2.5 font-ui text-body-sm font-semibold text-ink-900">元数据</h2>
          <div className="flex flex-col gap-2.5">
            {transcript.metadata.map(({ key, value }) => (
              <div key={key}>
                <div className="font-ui text-caption text-ink-400">{key}</div>
                <div className="break-all font-data text-body-sm text-ink-600">{value}</div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
