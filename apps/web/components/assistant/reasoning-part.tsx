"use client";

/**
 * ReasoningPart — collapsed-by-default disclosure for DeepSeek-Reasoner
 * (or any provider's) `reasoning` UIMessagePart.
 *
 * Borrowed from PostHog Thread.tsx ReasoningMessage shape (collapse to
 * "Thought" header when done, expand inline while streaming) but rewritten
 * in Mauve Quiet design tokens.
 *
 * Default behavior:
 *   - state="streaming" → expanded, header "Morris 正在思考…" + spinner
 *   - state="done"      → collapsed, header "已思考 (点击查看)"; click expands
 *
 * Visual rules per .kiro/steering/design-system.md::Disclosure rows:
 *   - flex items-center justify-between w-full
 *   - chevron flush right via SPACE_BETWEEN
 *   - bg-mauve-50 / border-mauve-200 (quiet — never compete with real answer)
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Lightbulb } from "lucide-react";

import { Markdown } from "./markdown";

interface ReasoningPartProps {
  text: string;
  state?: "streaming" | "done";
}

export function ReasoningPart({ text, state = "done" }: ReasoningPartProps) {
  const isStreaming = state === "streaming";
  const [expanded, setExpanded] = useState(isStreaming);

  // While streaming we always force-expand so the user sees live thoughts;
  // after done we honor whatever the user toggled.
  const showBody = isStreaming || expanded;

  return (
    <div
      data-testid="reasoning-part"
      data-state={state}
      className="rounded-md border border-mauve-200 bg-mauve-50 text-ink-600"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={isStreaming}
        aria-expanded={showBody}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left disabled:cursor-default"
      >
        <span className="flex items-center gap-1.5 font-ui text-body-sm text-ink-600">
          {isStreaming ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Lightbulb size={13} />
          )}
          {isStreaming ? "Morris 正在思考…" : "已思考"}
          {!isStreaming && (
            <span className="ml-1 font-ui text-caption text-ink-400">
              ({expanded ? "点击折叠" : "点击展开"})
            </span>
          )}
        </span>
        {!isStreaming &&
          (showBody ? (
            <ChevronDown size={14} className="shrink-0 text-ink-400" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-ink-400" />
          ))}
      </button>
      {showBody && (
        <div
          data-testid="reasoning-part-body"
          className="border-t border-mauve-200 px-3 py-2 text-ink-600"
        >
          {/* Reasoning is usually plain prose with light markdown; reuse the
            * existing Markdown renderer so callouts / code blocks / lists are
            * consistent with the answer body. Italic wrapper softens it
            * compared to the actual answer. */}
          <div className="font-reading text-body-sm italic leading-6">
            <Markdown>{text}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
