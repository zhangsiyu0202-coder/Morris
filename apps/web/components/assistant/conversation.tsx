"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, Loader2, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { ToolResult } from "./tool-results";
import { Markdown } from "./markdown";
import { usePageContextRef } from "./page-context-provider";

const TOOL_PENDING_LABEL: Record<string, string> = {
  createStudyDraft: "正在拟定调研草稿…",
  searchInterviewData: "正在检索访谈数据…",
  analyzeData: "正在分析结果…",
  listStudies: "正在读取调研列表…",
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
}: {
  suggestions?: string[];
  compact?: boolean;
}) {
  const [input, setInput] = useState("");
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
  const { messages, sendMessage, status, error, regenerate, clearError } = useChat({
    transport,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    sendMessage({ text: trimmed });
    setInput("");
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
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
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
                      if (part.type.startsWith("tool-")) {
                        const toolName = part.type.slice(5);
                        const tp = part as unknown as { state: string; output?: unknown };
                        if (tp.state === "output-available") {
                          return <ToolResult key={i} toolName={toolName} output={tp.output} />;
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
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder="问我任何关于你调研的问题…"
            className="max-h-32 flex-1 resize-none rounded-md border border-mauve-200 bg-ink-0 px-3.5 py-2.5 font-ui text-body-sm leading-6 text-ink-900 shadow-xs outline-none transition-colors placeholder:text-ink-400 focus:border-mauve-400"
          />
          <button
            type="submit"
            disabled={!input.trim() || isBusy}
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ink-800 text-ink-0 transition-colors hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="发送"
          >
            {isBusy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
          </button>
        </form>
      </div>
    </div>
  );
}
