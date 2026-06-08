"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { getRecordingDownloadUrl } from "@/lib/actions/recordings";

export function RecordingDownloadButton({
  sessionId,
  disabled,
  label,
  className,
}: {
  sessionId: string;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    if (disabled || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await getRecordingDownloadUrl(sessionId);
      if ("error" in result) {
        setError(result.error === "no_recording" ? "暂无录像" : "无法下载");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        aria-disabled={disabled || pending}
        className={className}
      >
        {!disabled && !pending && <Download className="mr-1.5 inline size-3.5" strokeWidth={2} />}
        {pending ? "准备下载…" : label}
      </button>
      {error && (
        <p className="mt-1 font-ui text-caption text-ink-400" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
