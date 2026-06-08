"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bookmark, Loader2, Trash2 } from "lucide-react";
import type { Bookmark as BookmarkRecord } from "@merism/contracts";
import { createBookmark, deleteBookmark } from "@/lib/actions/bookmarks";
import type { TranscriptTurn } from "@/lib/mock/workspace";

function formatTimeMs(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function respondentLabel(turn: TranscriptTurn): string {
  const role = turn.speaker === "respondent" ? "受访者" : "主持人";
  return `${role} · ${formatTimeMs(turn.startMs)}`;
}

function sourceLabel(studyTitle: string, turn: TranscriptTurn): string {
  return `${studyTitle} · ${turn.questionTag ?? "片段"}`;
}

export function TranscriptTurnRow({
  turn,
  studyId,
  sessionId,
  studyTitle,
  savedSegmentIndexes,
}: {
  turn: TranscriptTurn;
  studyId: string;
  sessionId: string;
  studyTitle: string;
  savedSegmentIndexes: Set<number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const saved = savedSegmentIndexes.has(turn.segmentIndex);

  const save = () => {
    if (saved || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createBookmark({
        surveyId: studyId,
        sessionId,
        quote: turn.text,
        source: sourceLabel(studyTitle, turn),
        respondent: respondentLabel(turn),
        segmentIndex: turn.segmentIndex,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-mauve-100 px-2 py-0.5 font-decor text-caption text-ink-900">
            {turn.speaker === "interviewer" ? "主持人" : "受访者"}
          </span>
          {turn.questionTag && (
            <span className="rounded-full bg-mauve-50 px-2 py-0.5 font-decor text-caption text-ink-600">
              {turn.questionTag}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saved || pending}
          aria-label={saved ? "已存为书签" : "存为书签"}
          className="inline-flex items-center gap-1 rounded px-2 py-1 font-ui text-caption text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:cursor-default disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Bookmark className="size-3" strokeWidth={2} />
          )}
          {saved ? "已存" : "存为书签"}
        </button>
      </div>
      <p className="font-reading text-body leading-7 text-ink-800">{turn.text}</p>
      {error && (
        <p className="mt-1 font-ui text-caption text-ink-400" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

export function TranscriptBookmarkSidebar({
  bookmarks,
}: {
  bookmarks: BookmarkRecord[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const remove = (id: string) => {
    setPendingId(id);
    void deleteBookmark(id).then(() => {
      setPendingId(null);
      router.refresh();
    });
  };

  return (
    <section>
      <div className="mb-3 flex items-center gap-1.5">
        <Bookmark className="size-3.5 text-ink-400" strokeWidth={2} />
        <h2 className="font-ui text-body-sm font-semibold text-ink-900">已存书签</h2>
      </div>
      {bookmarks.length === 0 ? (
        <p className="font-ui text-caption text-ink-400">尚未保存任何书签。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {bookmarks.map((bm) => (
            <div key={bm.$id} className="rounded-md border border-ink-100 p-2.5">
              <div className="mb-1 flex items-start justify-between gap-2">
                <span className="font-ui text-caption font-semibold text-ink-600">
                  {bm.respondent}
                </span>
                <button
                  type="button"
                  onClick={() => remove(bm.$id)}
                  disabled={pendingId === bm.$id}
                  aria-label="删除书签"
                  className="grid size-6 shrink-0 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
                >
                  {pendingId === bm.$id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" strokeWidth={2} />
                  )}
                </button>
              </div>
              <p className="line-clamp-3 font-reading text-body-sm leading-6 text-ink-600">
                {bm.quote}
              </p>
              <p className="mt-1 font-ui text-caption text-ink-400">{bm.source}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
