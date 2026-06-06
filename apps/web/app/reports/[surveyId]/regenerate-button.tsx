"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { regenerateSurveyReport } from "./actions";

interface Props {
  surveyId: string;
  variant?: "ghost" | "primary";
}

export function RegenerateButton({ surveyId, variant = "ghost" }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await regenerateSurveyReport(surveyId);
      if (!result.ok) setError(result.error);
    });
  };

  const baseClasses =
    "inline-flex items-center gap-1.5 rounded px-4 py-2 font-ui text-body-sm font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "mt-5 bg-mauve-200 text-ink-900 hover:bg-mauve-100"
      : "border border-mauve-300 bg-ink-0 text-ink-700 hover:bg-mauve-50";

  return (
    <div className={variant === "primary" ? "flex flex-col items-center" : "flex flex-col gap-2"}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`${baseClasses} ${styles} disabled:opacity-60`}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={2} />
        ) : (
          <RefreshCw className="size-4" strokeWidth={2} />
        )}
        {pending ? "生成中…" : "重新生成"}
      </button>
      {error && (
        <p className="font-ui text-caption text-ink-500">
          生成失败:{error}。稍后再试。
        </p>
      )}
    </div>
  );
}
