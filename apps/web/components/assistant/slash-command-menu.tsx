"use client";

/**
 * Slash command palette shown above the Morris input textarea.
 *
 * Pure presentational: parent (`Conversation`) owns the `query` (current input
 * minus the leading `/`) and the `highlightIndex` (which item the keyboard nav
 * has selected). The menu only renders the matched commands and emits
 * `onSelect` when a row is clicked.
 *
 * Keyboard navigation (↑/↓/Enter/Escape) lives in the parent's textarea
 * `onKeyDown` so the textarea retains focus.
 */

import { ChevronRight } from "lucide-react";
import { filterSlashCommands, type SlashCommand } from "@/lib/assistant/slash-commands";

interface SlashCommandMenuProps {
  /** Current text in the input *minus* the leading `/`. */
  query: string;
  /** Index of the highlighted row inside the *filtered* list. */
  highlightIndex: number;
  /** Click handler for a row. */
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandMenu({ query, highlightIndex, onSelect }: SlashCommandMenuProps) {
  const matches = filterSlashCommands(query);
  if (matches.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="斜杠命令"
      data-testid="slash-command-menu"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-md border border-mauve-200 bg-ink-0 shadow-popover"
    >
      <ul className="py-1">
        {matches.map((cmd, idx) => {
          const isActive = idx === highlightIndex;
          return (
            <li key={cmd.name} role="option" aria-selected={isActive}>
              <button
                type="button"
                data-testid={`slash-command-item-${cmd.name}`}
                onMouseDown={(e) => {
                  // Prevent the textarea from losing focus before the click fires.
                  e.preventDefault();
                }}
                onClick={() => onSelect(cmd)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                  isActive ? "bg-mauve-100" : "bg-ink-0 hover:bg-mauve-50"
                }`}
              >
                <span className="flex flex-1 items-center gap-2">
                  <span className="font-data text-body-sm text-ink-900">{cmd.label}</span>
                  <span className="font-ui text-body-sm text-ink-400">{cmd.description}</span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-ink-400" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
