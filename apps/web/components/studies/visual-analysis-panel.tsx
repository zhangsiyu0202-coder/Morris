"use client";

import { useRef } from "react";
import { Eye, Play } from "lucide-react";
import type { VisualAnalysisOutput } from "@merism/contracts";

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function VisualAnalysisPanel({
  sessionId,
  analysis,
}: {
  sessionId: string;
  analysis: VisualAnalysisOutput;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  function seekTo(ms: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, ms / 1000);
    void video.play();
  }

  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <Eye className="size-3.5 text-ink-500" strokeWidth={2} />
        <h2 className="font-ui text-body-sm font-semibold text-ink-900">视觉观察</h2>
      </div>

      <video
        ref={videoRef}
        src={`/api/recordings/${encodeURIComponent(sessionId)}/view`}
        controls
        preload="metadata"
        className="mb-4 aspect-video w-full rounded border border-ink-200 bg-ink-900"
      />

      <p className="font-reading text-body-sm leading-7 text-ink-600">{analysis.summary}</p>

      {analysis.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {analysis.tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-ink-200 px-2 py-0.5 font-data text-caption text-ink-500"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {analysis.keyMoments.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          {analysis.keyMoments.map((moment) => (
            <button
              key={moment.id}
              type="button"
              onClick={() => seekTo(moment.timestampMs)}
              className="group border-l border-ink-200 pl-3 text-left transition-colors hover:border-ink-500"
            >
              <span className="flex items-center gap-1.5 font-data text-caption text-ink-400 group-hover:text-ink-600">
                <Play className="size-3" strokeWidth={2} />
                {formatTimestamp(moment.timestampMs)}
              </span>
              <span className="block font-ui text-body-sm font-medium text-ink-900">
                {moment.label}
              </span>
              <span className="mt-1 block font-reading text-body-sm leading-6 text-ink-600">
                {moment.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {analysis.segments.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2.5">
          {analysis.segments.map((segment) => (
            <button
              key={segment.id}
              type="button"
              onClick={() => seekTo(segment.startMs)}
              className="rounded border border-ink-200 px-3 py-2.5 text-left transition-colors hover:border-ink-500"
            >
              <span className="flex items-center gap-1.5 font-data text-caption text-ink-400">
                <Play className="size-3" strokeWidth={2} />
                {formatTimestamp(segment.startMs)} - {formatTimestamp(segment.endMs)}
              </span>
              <span className="block font-ui text-body-sm font-medium text-ink-900">
                {segment.title}
              </span>
              <span className="mt-1 block font-reading text-body-sm leading-6 text-ink-600">
                {segment.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

