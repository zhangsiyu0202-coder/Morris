"use client";

/**
 * Morris HistoryPreview — start-page bottom card grid (per
 * `.kiro/specs/morris-conversation-persistence/` design.md §7).
 *
 * Borrowed from PostHog HistoryPreview.tsx shape (5-card row at the bottom
 * of the welcome screen). Returns null when there is nothing to show, so the
 * welcome screen stays clean for first-time users.
 *
 * Props:
 *   onSelect(id) — clicking a card swaps the active conversation
 *   limit        — max cards to render (default 5)
 *
 * Visual rules per .kiro/steering/design-system.md:
 *   - card: bg-ink-0 + border-ink-200 + rounded-md + shadow-sm + hover:shadow
 *   - 1 col on small viewports, 2 cols on >= sm (matches dock-vs-standalone form)
 *   - line-clamp-2 on preview text so taller cards do not jitter row height
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useOnConversationsInvalidate } from "./use-conversation-invalidate";

import { listConversations } from "@/lib/conversations/actions";
import type { ConversationListItem } from "@merism/contracts";

import { relativeTime } from "./conversation-history";

interface HistoryPreviewProps {
  onSelect: (id: string) => void;
  limit?: number;
  /** Visual compression — single column inside a narrow dock. */
  compact?: boolean;
}

export function HistoryPreview({
  onSelect,
  limit = 5,
  compact = false,
}: HistoryPreviewProps) {
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  // Track whether the component is still mounted so we don't call setItems on
  // a stale promise resolution after the user navigates away. (React 18+ no
  // longer warns about state-on-unmounted but it's still a real memory leak +
  // potential test-flake.)
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    listConversations()
      .then((list) => {
        if (mountedRef.current) setItems(list.slice(0, limit));
      })
      .catch(() => {
        if (mountedRef.current) setItems([]); // swallow on welcome screen — no banner here
      });
  }, [limit]);

  useEffect(() => {
    reload();
  }, [reload]);

  useOnConversationsInvalidate(reload);

  if (items === null) return null; // loading; welcome screen renders without a placeholder
  if (items.length === 0) return null; // empty → render nothing (no "no history" copy on welcome)

  return (
    <section
      aria-label="最近对话"
      data-testid="history-preview"
      className="mt-2 flex flex-col gap-2"
    >
      <h3 className="font-ui text-caption font-medium uppercase tracking-wide text-ink-400">
        最近对话
      </h3>
      <div
        className={`grid gap-2 ${
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
        }`}
      >
        {items.map((item) => (
          <button
            key={item.$id}
            type="button"
            data-testid={`preview-card-${item.$id}`}
            onClick={() => onSelect(item.$id)}
            className="flex flex-col gap-1.5 rounded-md border border-ink-200 bg-ink-0 p-3 text-left shadow-sm transition-shadow hover:shadow"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-ui text-body-sm font-medium text-ink-900">
                {item.title || "新对话"}
              </span>
              <span className="shrink-0 font-data text-caption text-ink-400">
                {relativeTime(item.lastMessageAt)}
              </span>
            </div>
            <p className="line-clamp-2 font-ui text-body-sm leading-5 text-ink-600">
              {item.lastMessagePreview || `${item.messageCount} 条消息`}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}
