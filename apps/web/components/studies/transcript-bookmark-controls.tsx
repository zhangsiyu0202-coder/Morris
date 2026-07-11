"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bookmark, Loader2, Play, Trash2 } from "lucide-react";
import type { Bookmark as BookmarkRecord } from "@merism/contracts";
import { createBookmark, deleteBookmark, updateBookmark } from "@/lib/actions/bookmarks";
import type { TranscriptTurn } from "@/lib/mock/workspace";
import { usePlayback } from "@/components/studies/session-playback";

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

/** Seek-to-moment chip shown next to a transcript turn / bookmark. */
function SeekButton({ startMs, label }: { startMs: number; label?: string }) {
  const { seekToMs } = usePlayback();
  return (
    <button
      type="button"
      onClick={() => seekToMs(startMs)}
      aria-label={`跳转到 ${formatTimeMs(startMs)}`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-data text-caption text-ink-400 transition-colors hover:bg-mauve-50 hover:text-ink-900"
    >
      <Play className="size-3" strokeWidth={2} />
      {label ?? formatTimeMs(startMs)}
    </button>
  );
}

export function TranscriptTurnRow({
  turn,
  endMs,
  studyId,
  sessionId,
  studyTitle,
  savedSegmentIndexes,
}: {
  turn: TranscriptTurn;
  endMs?: number;
  studyId: string;
  sessionId: string;
  studyTitle: string;
  savedSegmentIndexes: Set<number>;
}) {
  const router = useRouter();
  const { currentMs, hasMedia } = usePlayback();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const saved = savedSegmentIndexes.has(turn.segmentIndex);
  const active =
    hasMedia && currentMs >= turn.startMs && (endMs === undefined || currentMs < endMs);

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
        startMs: turn.startMs,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div
      className={
        active
          ? "-mx-3 rounded-sm bg-mauve-50 px-3 py-1 shadow-xs transition-colors"
          : "px-0 transition-colors"
      }
    >
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
          {hasMedia && <SeekButton startMs={turn.startMs} />}
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

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function textToTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** A single saved bookmark with seek, free-text note, and tag editing. */
function BookmarkCard({
  bookmark,
  startMs,
  isOwn,
}: {
  bookmark: BookmarkRecord;
  startMs?: number;
  isOwn: boolean;
}) {
  const router = useRouter();
  const { hasMedia } = usePlayback();
  const [note, setNote] = useState(bookmark.note);
  const [tagsText, setTagsText] = useState(tagsToText(bookmark.tags));
  const [pending, startTransition] = useTransition();
  const [removing, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Absolute recording offset is the seek target; fall back to the transcript
  // segment's start for bookmarks saved before startMs existed.
  const seekMs = bookmark.startMs ?? startMs;
  const dirty = note !== bookmark.note || tagsText !== tagsToText(bookmark.tags);

  const persist = () => {
    if (!dirty || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await updateBookmark(bookmark.$id, {
        note,
        tags: textToTags(tagsText),
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // Reconcile to the server-normalized values so the card no longer reads
      // as dirty (e.g. "a,a" -> "a") after a successful save.
      if (result.note !== undefined) setNote(result.note);
      if (result.tags !== undefined) setTagsText(tagsToText(result.tags));
      router.refresh();
    });
  };

  const remove = () => {
    startRemoving(async () => {
      const result = await deleteBookmark(bookmark.$id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="rounded-md border border-ink-100 p-2.5">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-ui text-caption font-semibold text-ink-600">
            {bookmark.respondent}
          </span>
          {hasMedia && seekMs !== undefined && <SeekButton startMs={seekMs} label="复看" />}
        </div>
        {isOwn ? (
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            aria-label="删除书签"
            className="grid size-6 shrink-0 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            {removing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" strokeWidth={2} />
            )}
          </button>
        ) : (
          <span className="shrink-0 rounded-xs bg-ink-100 px-1.5 py-0.5 font-decor text-caption text-ink-600">
            队友
          </span>
        )}
      </div>

      <p className="line-clamp-3 font-reading text-body-sm leading-6 text-ink-600">
        {bookmark.quote}
      </p>
      <p className="mt-1 font-ui text-caption text-ink-400">{bookmark.source}</p>

      {isOwn ? (
        <>
          <label className="mt-2 block">
            <span className="sr-only">批注</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="写下你的批注…"
              rows={2}
              className="w-full resize-y rounded-sm border border-ink-200 bg-ink-0 px-2 py-1.5 font-reading text-body-sm leading-6 text-ink-800 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
            />
          </label>

          <label className="mt-1.5 block">
            <span className="sr-only">标签(逗号分隔)</span>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="标签,逗号分隔"
              className="w-full rounded-sm border border-ink-200 bg-ink-0 px-2 py-1 font-data text-caption text-ink-600 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
            />
          </label>
        </>
      ) : (
        note && <p className="mt-2 font-reading text-body-sm leading-6 text-ink-800">{note}</p>
      )}

      {bookmark.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {bookmark.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-xs bg-mauve-100 px-1.5 py-0.5 font-decor text-caption text-ink-900"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {isOwn && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={persist}
            disabled={!dirty || pending}
            className="inline-flex items-center gap-1 rounded bg-mauve-200 px-3 py-1 font-ui text-caption font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:cursor-default disabled:opacity-60"
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            保存批注
          </button>
          {error && (
            <span className="font-ui text-caption text-ink-400" role="status">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function TranscriptBookmarkSidebar({
  bookmarks,
  segmentStartMs,
  currentUserId,
}: {
  bookmarks: BookmarkRecord[];
  segmentStartMs: Record<number, number>;
  currentUserId: string | null;
}) {
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
            <BookmarkCard
              key={bm.$id}
              bookmark={bm}
              isOwn={(bm.authorId ?? bm.ownerUserId) === currentUserId}
              startMs={
                typeof bm.segmentIndex === "number" ? segmentStartMs[bm.segmentIndex] : undefined
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
