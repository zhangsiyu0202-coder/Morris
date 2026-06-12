"use client";

/**
 * FeedbackButtons — thumbs up / thumbs down + optional textarea attached to
 * each assistant turn. Borrowed from PostHog FeedbackPrompt shape but kept
 * lightweight (no toast / no animation framework — just inline state).
 *
 * Lifecycle states:
 *   - "idle"       → both thumbs visible on hover (group-hover:opacity-100)
 *   - "rated_up"   → 已反馈 (向上) shown statically
 *   - "rating_down_text" → after user clicks down, prompt for optional text
 *   - "rated_down" → 已反馈 (向下) shown statically
 *   - "submitting" → buttons disabled with spinner
 *
 * Accessibility:
 *   - aria-pressed on each thumb
 *   - feedback textarea has aria-label
 *   - keyboard: Enter to submit, Escape to cancel
 */

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, Check, X } from "lucide-react";

import { submitFeedback, type FeedbackRating } from "@/lib/conversations/feedback";

interface FeedbackButtonsProps {
  conversationId: string | null;
  messageId: string;
}

type Phase = "idle" | "submitting" | "rated_up" | "rated_down" | "rating_down_text";

export function FeedbackButtons({ conversationId, messageId }: FeedbackButtonsProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [downText, setDownText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Without a conversationId nothing's been persisted yet — feedback would be
  // attached to a phantom row, so we hide the affordance until the first save.
  if (!conversationId) return null;

  async function send(rating: FeedbackRating, feedbackText?: string) {
    if (!conversationId) return;
    setPhase("submitting");
    setError(null);
    try {
      await submitFeedback({
        conversationId,
        messageId,
        rating,
        feedbackText: feedbackText && feedbackText.trim().length > 0
          ? feedbackText.trim()
          : undefined,
      });
      setPhase(rating === "up" ? "rated_up" : "rated_down");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交反馈失败");
      setPhase("idle");
    }
  }

  if (phase === "rated_up" || phase === "rated_down") {
    const Icon = phase === "rated_up" ? ThumbsUp : ThumbsDown;
    return (
      <div
        data-testid="feedback-rated"
        className="mt-1 inline-flex items-center gap-1 font-ui text-caption text-ink-400"
      >
        <Icon size={11} />
        <span>已反馈</span>
        <Check size={11} />
      </div>
    );
  }

  if (phase === "rating_down_text") {
    return (
      <div
        data-testid="feedback-down-text"
        className="mt-1 flex items-end gap-2 rounded-sm border border-mauve-200 bg-mauve-50 p-2"
      >
        <textarea
          aria-label="反馈内容 (可选)"
          rows={2}
          value={downText}
          onChange={(e) => setDownText(e.target.value)}
          maxLength={2000}
          placeholder="哪里不准 / 想要什么 (可选)"
          className="flex-1 resize-none rounded-sm border border-mauve-200 bg-ink-0 px-2 py-1 font-ui text-body-sm text-ink-900 outline-none placeholder:text-ink-400 focus:border-mauve-400"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send("down", downText);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setPhase("idle");
              setDownText("");
            }
          }}
        />
        <button
          type="button"
          onClick={() => void send("down", downText)}
          className="inline-flex h-7 items-center gap-1 rounded bg-mauve-200 px-2 font-ui text-body-sm text-ink-900 transition hover:bg-mauve-100"
        >
          提交
        </button>
        <button
          type="button"
          onClick={() => {
            setPhase("idle");
            setDownText("");
          }}
          aria-label="取消"
          className="flex size-7 items-center justify-center rounded text-ink-400 transition hover:bg-ink-100 hover:text-ink-900"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  const submitting = phase === "submitting";
  return (
    <div
      data-testid="feedback-idle"
      className="mt-1 inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
      <button
        type="button"
        aria-pressed={false}
        aria-label="觉得有帮助"
        disabled={submitting}
        onClick={() => void send("up")}
        className="flex size-6 items-center justify-center rounded-sm text-ink-400 transition-colors hover:bg-mauve-50 hover:text-ink-900 disabled:opacity-50"
      >
        {submitting ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
      </button>
      <button
        type="button"
        aria-pressed={false}
        aria-label="觉得不准 / 想反馈"
        disabled={submitting}
        onClick={() => setPhase("rating_down_text")}
        className="flex size-6 items-center justify-center rounded-sm text-ink-400 transition-colors hover:bg-mauve-50 hover:text-ink-900 disabled:opacity-50"
      >
        <ThumbsDown size={11} />
      </button>
      {error && <span className="ml-1 font-ui text-caption text-ink-900">{error}</span>}
    </div>
  );
}
