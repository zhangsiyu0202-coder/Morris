"use client";

/**
 * Standalone /assistant scene shell — owns the "history drawer vs conversation
 * pane" toggle and the "new conversation" + "history" header buttons.
 *
 * Why this is a separate client component instead of inlining in page.tsx:
 *   - page.tsx is an RSC (server-side loadConversation). Header buttons need
 *     useState + useRouter — that's a client boundary.
 *   - AssistantDock has its own header (different layout); this shell mirrors
 *     the same toggle + new-chat affordances using the standalone-page chrome.
 *
 * `key={conversationId}` on Conversation forces remount when the user switches
 * conversation via history — useChat keeps internal state per mount, so this
 * is the cleanest way to seed `initialMessages` for the new conversation.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, History, X } from "lucide-react";
import type { UIMessage } from "ai";

import { Conversation } from "./conversation";
import { ConversationHistory } from "./conversation-history";
import { createConversation } from "@/lib/conversations/actions";
import { useCurrentConversationId } from "./use-current-conversation-id";
import { invalidateConversations } from "./use-conversation-invalidate";

interface AssistantSceneShellProps {
  conversationId: string | null;
  initialMessages?: UIMessage[];
  suggestions?: string[];
}

export function AssistantSceneShell({
  conversationId,
  initialMessages,
  suggestions,
}: AssistantSceneShellProps) {
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // Mirror the URL conversationId into shared storage so the floating dock
  // picks up the same thread when reopened. URL is canonical; the hook only
  // writes downstream (no overwriting URL state from storage).
  const [, setSharedConversationId] = useCurrentConversationId(conversationId);
  // Whenever the URL conversationId changes, sync to storage.
  // (initial=conversationId already set on first mount.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSharedConversationId(conversationId);
  }, [conversationId]);

  async function handleNewConversation() {
    if (creating) return;
    setCreating(true);
    try {
      // Pre-create so URL is canonical from the start. Failures are silent —
      // the welcome screen renders without ?conversationId= and the user's
      // first message will retry createConversation via Conversation's submit.
      const { conversationId: newId } = await createConversation();
      invalidateConversations();
      router.push(`/assistant?conversationId=${newId}`);
    } catch {
      router.push("/assistant");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-mauve-200 bg-ink-0 px-4 py-2">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-label={historyOpen ? "关闭历史" : "打开历史"}
          aria-pressed={historyOpen}
          className="flex h-9 items-center gap-1.5 rounded px-3 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50"
        >
          {historyOpen ? <X size={16} /> : <History size={16} />}
          {historyOpen ? "关闭历史" : "历史对话"}
        </button>

        <button
          type="button"
          onClick={handleNewConversation}
          disabled={creating}
          className="flex h-9 items-center gap-1.5 rounded bg-mauve-200 px-3 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50"
        >
          <Plus size={16} />
          新对话
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {historyOpen && (
          <aside className="w-72 shrink-0 border-r border-mauve-200">
            <ConversationHistory
              currentId={conversationId}
              onSelect={(id) => {
                router.push(`/assistant?conversationId=${id}`);
                setHistoryOpen(false);
              }}
              onClose={() => setHistoryOpen(false)}
            />
          </aside>
        )}
        <div className="min-w-0 flex-1">
          {/* key forces remount on conversation switch so initialMessages take effect */}
          <Conversation
            key={conversationId ?? "welcome"}
            conversationId={conversationId ?? undefined}
            initialMessages={initialMessages}
            suggestions={suggestions}
          />
        </div>
      </div>
    </div>
  );
}
