"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import {
  createConversation,
  saveMessages,
  loadConversation,
} from "@/lib/conversations/actions";
import { ArrowUp, Loader2, Sparkles, AlertTriangle, RotateCcw, Square } from "lucide-react";
import { ToolResult } from "./tool-results";
import { SlashCommandMenu } from "./slash-command-menu";
import {
  filterSlashCommands,
  parseSlashCommand,
  SLASH_HELP_TEXT,
  type SlashCommand,
} from "@/lib/assistant/slash-commands";
import { TOOL_ENRICH_URLS } from "@/lib/assistant/tool-enrich-urls";
import { UNKNOWN_TOOL_METADATA } from "@/lib/assistant/tool-metadata";
import { Markdown } from "./markdown";
import { usePageContextRef } from "./page-context-provider";
import { HistoryPreview } from "./history-preview";
import { invalidateConversations } from "./use-conversation-invalidate";
import { ReasoningPart } from "./reasoning-part";
import { FeedbackButtons } from "./feedback-buttons";

const TOOL_PENDING_LABEL: Record<string, string> = {
  createStudyDraft: "正在拟定调研草稿…",
  searchInterviewData: "正在检索访谈数据…",
  analyzeData: "正在分析结果…",
  listStudies: "正在读取调研列表…",
  createNotebook: "正在写 Notebook…",
};

function getMessageText(parts: { type: string; text?: string }[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export function Conversation({
  suggestions,
  compact = false,
  conversationId: initialConversationId,
  initialMessages,
}: {
  suggestions?: string[];
  compact?: boolean;
  /** Existing conversation id loaded from URL ?conversationId= or null on first visit. */
  conversationId?: string;
  /** Persisted UIMessages to seed useChat with. Comes from server-side loadConversation. */
  initialMessages?: UIMessage[];
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  // currentId tracks the active conversation in this component lifecycle. null
  // until first user message; then we lazy-create a Conversation row, set this,
  // and shallow-replace the URL.
  const [currentId, setCurrentId] = useState<string | null>(
    initialConversationId ?? null,
  );
  // Save lifecycle indicator surfaced as a non-blocking banner. We never throw
  // out of onFinish — UX must keep flowing even if Appwrite save fails.
  const [saveError, setSaveError] = useState<string | null>(null);
  // 拿到一个始终读最新 PageContext 的 ref。我们用 ref 而不是 state, 因为 transport
  // 实例只在挂载时构造一次, 不会响应 React 状态变化。
  const pageContextRef = usePageContextRef();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/assistant",
        // 每次发送把当前页面的 PageContext 注入到请求体, 路由层会校验 + 渲染到 system prompt 的动态段。
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...(body ?? {}), messages, pageContext: pageContextRef.current },
        }),
      }),
    [pageContextRef],
  );
  const { messages, sendMessage, status, error, regenerate, clearError, stop, setMessages } =
    useChat({
      transport,
      // Seed with persisted history when the URL carries a conversationId.
      messages: initialMessages,
      // Fired after the assistant turn finishes (or errors). We persist the
      // **complete** messages array (user + assistant + tool parts), not a
      // delta — that matches the on-the-wire shape useChat manages internally
      // and keeps reload/refresh round-trip lossless.
      // useChat's onFinish callback delivers the canonical final messages array
      // — including the just-finished assistant turn — as `messages`. We MUST
      // use that arg (not the closure `messages` from the outer destructure)
      // because React state updates are batched and the closure captures the
      // pre-finish snapshot, missing the assistant reply we want to persist.
      onFinish: async ({ messages: finalMessages, isAbort, isError }) => {
        if (!currentId) return; // pre-create race; first turn handles its own save below
        if (isAbort || isError) {
          // User stopped or stream errored — partial assistant text is in the
          // array but we still persist so reload survives. (PostHog's parity
          // call: their conversation queue saves the error frame too.)
        }
        try {
          await saveMessages(currentId, finalMessages);
          setSaveError(null);
          // Title may now have been generated; refresh history surfaces.
          invalidateConversations();
        } catch (err) {
          // Best-effort retry once after 3s; if it still fails, surface a
          // non-blocking banner so the user knows refresh will lose the turn.
          // Keep the in-memory conversation flowing — never throw to onFinish.
          const message = err instanceof Error ? err.message : String(err);
          if (mountedRef.current) setSaveError(message);
          const timeoutId = setTimeout(() => {
            if (!mountedRef.current) return;
            saveMessages(currentId, finalMessages)
              .then(() => {
                if (mountedRef.current) setSaveError(null);
              })
              .catch(() => {
                // banner already up; keep the explanatory string
              });
          }, 3000);
          // Best-effort: if the component unmounts before the retry fires,
          // clearTimeout. mountedRef guard above handles the case where
          // setTimeout already fired but the inner call hadn't started.
          // Stored on ref to allow cleanup without re-rendering.
          retryTimeoutRef.current = timeoutId;
        }
      },
    });
  const scrollRef = useRef<HTMLDivElement>(null);
  // Sticky-bottom flag — true when the user's scroll position is within
  // STICKY_BOTTOM_PX of the bottom. Borrowed from PostHog ThreadAutoScroller:
  // we only auto-scroll on new messages when the user is already at/near the
  // bottom, so reading older messages is not interrupted by streaming.
  const stickyBottomRef = useRef<boolean>(true);
  // Guard against a double-send race on the very first message: clicking send
  // twice while createConversation is still in flight would otherwise create
  // two phantom conversation docs (and only one of them gets the assistant
  // turn). isBusy doesn't help because useChat hasn't started the stream yet
  // — the await is happening in submit(), before sendMessage.
  const creatingFirstConversationRef = useRef<boolean>(false);
  // Mount guard for async paths that touch state after long awaits (the
  // saveMessages 3s retry timeout below would otherwise call setSaveError on
  // an unmounted component when the user closes the dock or navigates away).
  const mountedRef = useRef<boolean>(true);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);
  const isBusy = status === "submitted" || status === "streaming";

  // Slash-command palette state. The textarea owns input value; this state only
  // tracks which command row is keyboard-highlighted in the floating panel.
  const [highlightIndex, setHighlightIndex] = useState(0);
  const slashTrim = input.trimStart();
  const isSlashMode = slashTrim.startsWith("/");
  const slashMatches = isSlashMode ? filterSlashCommands(slashTrim.slice(1)) : [];
  const slashMenuVisible = isSlashMode && slashMatches.length > 0;

  // Reset highlight when matches list shrinks below current index (user typed
  // more characters and the active row no longer exists).
  useEffect(() => {
    if (slashMenuVisible && highlightIndex >= slashMatches.length) {
      setHighlightIndex(0);
    }
  }, [slashMatches.length, slashMenuVisible, highlightIndex]);

  // Fallback loader: when a parent renders <Conversation conversationId={X}>
  // without a server-side initialMessages prop (e.g. AssistantDock — purely
  // client, no RSC), fetch the conversation here so the user sees the
  // persisted thread instead of a blank slate. Skip when initialMessages was
  // already passed (the standalone /assistant scene streams it via RSC and
  // we don't want a double-load that flashes empty → seeded).
  useEffect(() => {
    if (!initialConversationId) return;
    if (initialMessages !== undefined) return; // RSC seeded path
    let cancelled = false;
    loadConversation(initialConversationId)
      .then((data) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.messages)) return;
        // Race guard: if the user already started sending while we were
        // fetching, don't clobber their in-flight messages with the persisted
        // snapshot. This typically happens on slow loads where the user types
        // before the fetch finishes.
        if (messages.length > 0) return;
        setMessages(data.messages as UIMessage[]);
      })
      .catch(() => {
        // Silent — same fallback policy as scene-shell SSR catch block.
      });
    return () => {
      cancelled = true;
    };
    // initialConversationId is captured by-value at mount via the prop; this
    // effect runs once per Conversation lifecycle (parent forces remount via
    // key={conversationId} when switching). Adding `messages` to the deps
    // would re-fire on every chunk during streaming — we intentionally
    // capture the empty-at-mount snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  // Track whether the scroll container is locked to the bottom. Updates on
  // every user scroll. Threshold matches PostHog (32px) — a small slack so
  // 1-2px rounding errors don't unlock unexpectedly.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const STICKY_BOTTOM_PX = 32;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyBottomRef.current = distanceFromBottom <= STICKY_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new messages — only when the user is at the bottom. If they
  // scrolled up to read history we leave them be; the next time they scroll
  // back to within STICKY_BOTTOM_PX, the sticky flag flips back to true and
  // the next message tick auto-scrolls again.
  useEffect(() => {
    if (!stickyBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  /**
   * Dispatch a slash command. Returns `true` when the input was consumed (any
   * known command) and `false` for `send_literal` (unknown verb / not a slash
   * command), in which case the caller falls back to `sendMessage`.
   */
  function handleSlashCommand(text: string): boolean {
    const action = parseSlashCommand(text);
    switch (action.kind) {
      case "new":
        // TODO: 等 morris-conversation-persistence Wave A subagent A 的
        // createConversation Server Action 接通后, 在这里调用并切换 conversationId.
        return true;
      case "clear":
        // setMessages 由 @ai-sdk/react useChat 提供; 当前版本 (3.0.198) 一定返回。
        // 真有一天没了 (依赖回退) — 退而求其次 reload 让页面回到 0 消息状态。
        if (typeof setMessages === "function") {
          setMessages([]);
        } else if (typeof window !== "undefined") {
          window.location.reload();
        }
        return true;
      case "list":
        sendMessage({ text: "列出我所有的调研" });
        return true;
      case "study":
        sendMessage({
          text: `切换到调研 ${action.id} 上下文, 给我列出最近 sessions`,
        });
        return true;
      case "help":
        // 本地 append 一条 assistant 消息列出命令; 不发到 /api/assistant. 只在
        // setMessages 可用时这样做; fallback 走 send_literal 让 LLM 来回答。
        if (typeof setMessages === "function") {
          setMessages((prev) => [
            ...prev,
            {
              id: `help-${Date.now()}`,
              role: "assistant",
              parts: [{ type: "text", text: SLASH_HELP_TEXT }],
            },
          ]);
          return true;
        }
        return false;
      case "send_literal":
        // 未知命令 (`/foo`) 或不是 slash — 回到普通 sendMessage 路径。
        return false;
    }
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    if (trimmed.startsWith("/")) {
      const handled = handleSlashCommand(trimmed);
      if (handled) {
        setInput("");
        return;
      }
      // fall-through: parser returned `send_literal` (unknown verb) — send as
      // a normal user message so the user is never silently swallowed.
    }
    // Lazy-create the Conversation row on the very first user message so empty
    // dock opens never pollute the history list. We await before sendMessage so
    // onFinish has currentId in scope; the URL replace is shallow (no scroll,
    // no layout reflow) so the streaming UI is uninterrupted.
    let id = currentId;
    if (!id) {
      if (creatingFirstConversationRef.current) {
        // Another submit() is mid-await on createConversation; drop this one
        // — the in-flight call will resolve and the user's *first* click owns
        // the doc. Setting input back so the user can re-send if they want.
        return;
      }
      creatingFirstConversationRef.current = true;
      try {
        const result = await createConversation();
        id = result.conversationId;
        setCurrentId(id);
        router.replace(`/assistant?conversationId=${id}`, { scroll: false });
        invalidateConversations();
      } catch (err) {
        // If we can't even create the doc, fall back to in-memory mode (no
        // persistence) so the user's first message still goes through. Surface
        // the error in the save banner.
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(`无法创建对话记录: ${message}. 本次回合将不被保存.`);
      } finally {
        creatingFirstConversationRef.current = false;
      }
    }
    sendMessage({ text: trimmed });
    setInput("");
  }

  /** Click handler for a row in the slash-command palette. */
  function selectSlashCommand(cmd: SlashCommand) {
    if (cmd.argHint) {
      // Command takes an arg (e.g. `/study <id>`). Don't execute yet — pre-fill
      // the input and let the user type the arg, then press Enter.
      setInput(`/${cmd.name} `);
      setHighlightIndex(0);
      return;
    }
    submit(`/${cmd.name}`);
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className={`mx-auto flex flex-col gap-5 ${compact ? "max-w-full px-4 py-4" : "max-w-3xl px-6 py-8"}`}>
          {isEmpty && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-mauve-100 text-ink-600">
                <Sparkles size={20} />
              </span>
              <div>
                <h2 className="font-display text-display-md text-ink-900">研究助手</h2>
                <p className="mt-1 font-ui text-body-sm text-ink-400">
                  让我帮你创建调研、检索访谈、分析结果。
                </p>
              </div>
              {suggestions && suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => submit(s)}
                      className="rounded-full border border-mauve-200 bg-ink-0 px-3 py-1.5 font-ui text-body-sm text-ink-600 transition-colors hover:border-mauve-400 hover:text-ink-900"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <HistoryPreview
                compact={compact}
                onSelect={(id) => {
                  setCurrentId(id);
                  router.replace(`/assistant?conversationId=${id}`, { scroll: false });
                  // Hard refresh of the message list will happen on the next mount
                  // when AssistantPage's server-side loadConversation feeds new
                  // initialMessages via key={conversationId}. Until then we leave
                  // messages array untouched (still empty).
                }}
              />
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "flex justify-end" : "group flex justify-start"}>
              <div className={message.role === "user" ? "max-w-[85%]" : "w-full"}>
                {message.role === "user" ? (
                  <div className="rounded-lg rounded-tr-sm bg-ink-800 px-4 py-2.5 font-ui text-body-sm leading-6 text-ink-0">
                    {getMessageText(message.parts)}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {message.parts.map((part, i) => {
                      if (part.type === "text") {
                        return part.text ? <Markdown key={i}>{part.text}</Markdown> : null;
                      }
                      if (part.type === "reasoning") {
                        // Vercel AI SDK 6 ReasoningUIPart: { type: "reasoning"; text; state? }
                        // Render in a quiet collapsed disclosure (default) so the
                        // user's eyes go to the answer; reasoning is opt-in.
                        const rp = part as unknown as { text?: string; state?: "streaming" | "done" };
                        return rp.text ? (
                          <ReasoningPart key={i} text={rp.text} state={rp.state} />
                        ) : null;
                      }
                      if (part.type.startsWith("tool-")) {
                        const toolName = part.type.slice(5);
                        const tp = part as unknown as { state: string; output?: unknown };
                        if (tp.state === "output-available") {
                          // metadata 在 client 侧从 TOOL_ENRICH_URLS 取 enrichUrl, 其余字段 fallback (Wave E T21).
                          const enrichUrl = TOOL_ENRICH_URLS[toolName];
                          const metadata = enrichUrl
                            ? { ...UNKNOWN_TOOL_METADATA, enrichUrl }
                            : UNKNOWN_TOOL_METADATA;
                          return (
                            <ToolResult
                              key={i}
                              toolName={toolName}
                              output={tp.output}
                              metadata={metadata}
                            />
                          );
                        }
                        return (
                          <div key={i} className="inline-flex items-center gap-2 font-ui text-body-sm text-ink-400">
                            <Loader2 size={14} className="animate-spin" />
                            {TOOL_PENDING_LABEL[toolName] ?? "处理中…"}
                          </div>
                        );
                      }
                      return null;
                    })}
                    <FeedbackButtons
                      conversationId={currentId}
                      messageId={message.id}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          {status === "submitted" && (
            <div className="inline-flex items-center gap-2 font-ui text-body-sm text-ink-400">
              <Loader2 size={14} className="animate-spin" />
              思考中…
            </div>
          )}

          {saveError && (
            <div className="flex items-start gap-2 rounded-md border border-mauve-200 bg-mauve-50 px-3 py-2.5">
              <span className="mt-0.5 shrink-0" style={{ color: "var(--color-negative)" }}>
                <AlertTriangle size={14} />
              </span>
              <div className="flex-1">
                <p className="font-ui text-body-sm leading-6 text-ink-800">
                  对话未保存: {saveError}
                </p>
                <p className="mt-0.5 font-ui text-caption text-ink-400">
                  对话仍在内存中, 但刷新页面后会丢失. 系统会自动重试一次.
                </p>
              </div>
              <button
                onClick={() => setSaveError(null)}
                className="font-ui text-caption text-ink-400 hover:text-ink-900"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex items-start gap-2 rounded-md border border-mauve-200 bg-mauve-50 px-3 py-2.5">
              <span className="mt-0.5 shrink-0" style={{ color: "var(--color-negative)" }}>
                <AlertTriangle size={14} />
              </span>
              <div className="flex-1">
                <p className="font-ui text-body-sm leading-6 text-ink-800">
                  {error?.message?.trim() ? error.message : "出了点问题,请重试。"}
                </p>
                <button
                  onClick={() => {
                    clearError();
                    regenerate();
                  }}
                  className="mt-1.5 inline-flex items-center gap-1.5 font-ui text-body-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
                >
                  <RotateCcw size={13} /> 重试
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-mauve-200 bg-mauve-50/60 px-4 py-3 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className={`mx-auto flex items-end gap-2 ${compact ? "max-w-full" : "max-w-3xl"}`}
        >
          <div className="relative flex-1">
            {slashMenuVisible && (
              <SlashCommandMenu
                query={slashTrim.slice(1)}
                highlightIndex={highlightIndex}
                onSelect={selectSlashCommand}
              />
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Slash-mode keyboard nav takes precedence over plain Enter-to-send
                // so users can pick a command from the floating palette.
                if (slashMenuVisible) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightIndex((idx) =>
                      Math.min(idx + 1, slashMatches.length - 1),
                    );
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightIndex((idx) => Math.max(idx - 1, 0));
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const cmd = slashMatches[highlightIndex];
                    if (cmd) selectSlashCommand(cmd);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInput("");
                    setHighlightIndex(0);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              rows={1}
              placeholder="问我任何关于你调研的问题…"
              className="max-h-32 w-full resize-none rounded-md border border-mauve-200 bg-ink-0 px-3.5 py-2.5 font-ui text-body-sm leading-6 text-ink-900 shadow-xs outline-none transition-colors placeholder:text-ink-400 focus:border-mauve-400"
            />
          </div>
          {isBusy ? (
            <button
              type="button"
              onClick={() => stop()}
              data-testid="assistant-stop-button"
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-ink-900 bg-ink-0 text-ink-900 transition-colors hover:bg-mauve-50"
              aria-label="停止"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              data-testid="assistant-send-button"
              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ink-800 text-ink-0 transition-colors hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="发送"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
