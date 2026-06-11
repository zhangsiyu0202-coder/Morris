"use client";

/**
 * Morris Conversation History drawer (per `.kiro/specs/morris-conversation-persistence/`
 * design.md §7).
 *
 * Borrowed from PostHog `ConversationHistory.tsx` shape (drawer-style list of
 * past conversations), but rewritten in our stack: server actions + Appwrite
 * (not Django + Postgres + LangGraph checkpoints), Mauve Quiet design tokens
 * (not lemon-ui), no kea (plain useState).
 *
 * Form factor:
 *  - Standalone in /assistant scene: full-width vertical drawer alongside the
 *    Conversation pane.
 *  - In AssistantDock: shown as a flyout taking over the dock body when the
 *    user clicks the "history" icon in the dock header.
 *
 * Lifecycle states (all visible in tests):
 *  - loading  → spinner + "正在加载历史…"
 *  - error    → error banner + retry button (clears error + re-fetches)
 *  - empty    → empty-state copy "还没有对话历史…"
 *  - loaded   → list of items with hover/active/delete affordances
 *
 * Visual rules per .kiro/steering/design-system.md:
 *  - hover row → bg-mauve-50
 *  - active row (matches currentId) → bg-mauve-100 + aria-current="page"
 *  - delete button is hover-only (group-hover:opacity-100)
 *  - delete confirm is a controlled inline dialog (NOT browser confirm() —
 *    that violates the design system; we use an outline/primary button pair)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useOnConversationsInvalidate, invalidateConversations } from "./use-conversation-invalidate";
import { Trash2, MessageSquare, Loader2, AlertTriangle, X, RotateCcw } from "lucide-react";

import {
  listConversations,
  deleteConversation,
} from "@/lib/conversations/actions";
import type { ConversationListItem } from "@merism/contracts";

interface ConversationHistoryProps {
  /** Currently-active conversation id (highlights that row). */
  currentId: string | null;
  /** Called when the user clicks a row. Parent should swap the active conversation. */
  onSelect: (id: string) => void;
  /** Optional: if provided, renders a close X in the header. */
  onClose?: () => void;
}

/** Convert ISO datetime to Chinese relative-time string. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function ConversationHistory({
  currentId,
  onSelect,
  onClose,
}: ConversationHistoryProps) {
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Mount guard — listConversations is async; if the user closes the drawer
  // mid-flight we drop the result rather than setItems on an unmounted tree.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (mountedRef.current) setError(null);
    try {
      const list = await listConversations();
      if (mountedRef.current) setItems(list);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "加载历史失败");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the inline delete-confirm dialog (not blocking — just a UX
  // shortcut so the user doesn't have to click 取消). No-op when no dialog
  // is open. Captures at the document level since the dialog inputs aren't
  // necessarily focused.
  useEffect(() => {
    if (!pendingDeleteId) return;
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) {
        setPendingDeleteId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDeleteId, deleting]);

  // Reload when another surface mutates the conversations list.
  useOnConversationsInvalidate(() => {
    void load();
  });

  async function handleConfirmDelete(id: string) {
    setDeleting(id);
    try {
      await deleteConversation(id);
      setItems((prev) => (prev ?? []).filter((i) => i.$id !== id));
      setPendingDeleteId(null);
      invalidateConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-ink-0">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-mauve-200 px-4 py-3">
        <h2 className="font-display text-body-lg text-ink-900">历史对话</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-sm text-ink-400 transition-colors hover:bg-mauve-50 hover:text-ink-900"
            aria-label="关闭历史"
          >
            <X size={16} />
          </button>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto" data-testid="conversation-history-body">
        {items === null && !error && (
          <div
            className="flex h-full items-center justify-center gap-2 py-8 font-ui text-body-sm text-ink-400"
            data-testid="history-loading"
          >
            <Loader2 size={14} className="animate-spin" />
            正在加载历史…
          </div>
        )}

        {error && (
          <div
            className="m-3 flex items-start gap-2 rounded-md border border-mauve-200 bg-mauve-50 px-3 py-2.5"
            data-testid="history-error"
          >
            <span className="mt-0.5 shrink-0 text-ink-900">
              <AlertTriangle size={14} />
            </span>
            <div className="flex-1">
              <p className="font-ui text-body-sm leading-6 text-ink-800">{error}</p>
              <button
                type="button"
                onClick={load}
                className="mt-1.5 inline-flex items-center gap-1 font-ui text-body-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
              >
                <RotateCcw size={13} /> 重试
              </button>
            </div>
          </div>
        )}

        {items !== null && items.length === 0 && !error && (
          <p
            className="px-6 py-10 text-center font-ui text-body-sm text-ink-400"
            data-testid="history-empty"
          >
            还没有对话历史. 试试给 Morris 发第一条消息.
          </p>
        )}

        {items !== null && items.length > 0 && (
          <ul role="list" className="flex flex-col gap-0.5 p-2">
            {items.map((item) => {
              const isActive = currentId === item.$id;
              const isPending = pendingDeleteId === item.$id;
              return (
                <li key={item.$id} role="listitem">
                  {!isPending ? (
                    <div
                      className={`group flex items-center gap-2 rounded-sm transition-colors ${
                        isActive ? "bg-mauve-100" : "hover:bg-mauve-50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(item.$id)}
                        aria-current={isActive ? "page" : undefined}
                        data-testid={`history-item-${item.$id}`}
                        className="flex flex-1 items-center gap-2 px-3 py-2 text-left"
                      >
                        <MessageSquare size={14} className="shrink-0 text-ink-400" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-ui text-body-sm text-ink-900">
                            {item.title || "新对话"}
                          </div>
                          <div className="font-data text-caption text-ink-400">
                            {item.messageCount} msgs · {relativeTime(item.lastMessageAt)}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除对话 ${item.title || "新对话"}`}
                        data-testid={`history-delete-${item.$id}`}
                        onClick={() => setPendingDeleteId(item.$id)}
                        className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-400 opacity-0 transition-opacity hover:text-ink-900 group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <div
                      data-testid={`history-confirm-delete-${item.$id}`}
                      className="flex flex-col gap-2 rounded-sm border border-ink-900 bg-ink-0 p-3"
                    >
                      <p className="font-ui text-body-sm text-ink-900">
                        删除 &quot;{item.title || "新对话"}&quot;?
                      </p>
                      <p className="font-ui text-caption text-ink-400">
                        此操作不可撤销.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirmDelete(item.$id)}
                          disabled={deleting === item.$id}
                          data-testid={`history-confirm-yes-${item.$id}`}
                          className="inline-flex h-8 items-center gap-1 rounded bg-mauve-200 px-3 text-body-sm text-ink-900 transition hover:bg-mauve-100 disabled:opacity-50"
                        >
                          {deleting === item.$id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : null}
                          确认删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          disabled={deleting === item.$id}
                          className="inline-flex h-8 items-center rounded border border-ink-900 bg-ink-0 px-3 text-body-sm text-ink-900 transition hover:bg-mauve-50 disabled:opacity-50"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
