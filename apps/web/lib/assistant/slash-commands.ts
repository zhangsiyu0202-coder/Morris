/**
 * Slash command catalog and parser for the Morris page-assistant input box.
 *
 * Pure module: the menu UI (`components/assistant/slash-command-menu.tsx`) and
 * the conversation submit handler (`components/assistant/conversation.tsx`)
 * import from here so the same shape drives auto-complete and dispatch.
 *
 * Five built-ins are listed in `SLASH_COMMANDS`. The dispatch verbs are encoded
 * as a discriminated `SlashCommandAction` so consumers do not re-string-parse.
 *
 * Subagent A's `createConversation` is not yet wired; `/new` resolves to the
 * `kind: "new"` action and the conversation component leaves it as a TODO until
 * the persistence wave lands.
 */

/** Visual + behavioural metadata for one slash command. */
export interface SlashCommand {
  /** Verb after the leading `/` (e.g. `"clear"` → user types `/clear`). */
  readonly name: string;
  /** Argument hint for the command palette (e.g. `"<id>"`). */
  readonly argHint?: string;
  /** Short label shown in the palette row. */
  readonly label: string;
  /** Description shown in the palette row. */
  readonly description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "new",
    label: "/new",
    description: "开新对话(等持久化接入)",
  },
  {
    name: "clear",
    label: "/clear",
    description: "清空当前对话消息",
  },
  {
    name: "list",
    label: "/list",
    description: "列出我的所有调研",
  },
  {
    name: "study",
    argHint: "<id>",
    label: "/study <id>",
    description: "切换到指定调研上下文",
  },
  {
    name: "help",
    label: "/help",
    description: "查看可用命令",
  },
];

/**
 * Discriminated action emitted by `parseSlashCommand`. The conversation
 * component switches on `kind` to decide how to dispatch (call `setMessages`,
 * call `sendMessage`, no-op, etc.).
 */
export type SlashCommandAction =
  | { kind: "new" }
  | { kind: "clear" }
  | { kind: "list" }
  | { kind: "study"; id: string }
  | { kind: "help" }
  /**
   * Either the input did not start with `/`, or it was `/<unknown verb>`.
   * Either way the conversation falls back to sending the literal text so the
   * user is never silently swallowed.
   */
  | { kind: "send_literal"; text: string };

/** Parse trimmed input. Empty / whitespace input returns `send_literal`. */
export function parseSlashCommand(rawText: string): SlashCommandAction {
  const text = rawText.trim();
  if (!text.startsWith("/")) return { kind: "send_literal", text };
  // strip the leading slash, split on whitespace
  const [verb, ...args] = text.slice(1).split(/\s+/);
  switch (verb) {
    case "new":
      return { kind: "new" };
    case "clear":
      return { kind: "clear" };
    case "list":
      return { kind: "list" };
    case "study":
      return { kind: "study", id: args[0] ?? "" };
    case "help":
      return { kind: "help" };
    default:
      // Unknown command: pass the original text through as a normal user message
      // (per work order: "未知命令 /foo 当普通消息发").
      return { kind: "send_literal", text };
  }
}

/**
 * Filter the catalog by a typed prefix (the bit after the leading `/`).
 *
 * Empty prefix returns the full catalog. The match is case-insensitive on the
 * command verb. We do not rank — order in `SLASH_COMMANDS` is the canonical
 * order for the palette.
 */
/**
 * Subsequence match — does every char of `query` appear in `candidate` in
 * order (with possible gaps)? Lets `/clr` match `clear`, `/hp` match `help`,
 * etc. Empty query matches everything.
 */
function isSubsequence(query: string, candidate: string): boolean {
  if (query.length === 0) return true;
  let qi = 0;
  for (let ci = 0; ci < candidate.length && qi < query.length; ci++) {
    if (candidate[ci] === query[qi]) qi++;
  }
  return qi === query.length;
}

/** Score a candidate against the query: prefix > subsequence > miss. */
function scoreCandidate(query: string, name: string): number {
  if (!query) return 1;
  if (name.startsWith(query)) return 100;
  if (isSubsequence(query, name)) return 50;
  return 0;
}

export function filterSlashCommands(prefix: string): readonly SlashCommand[] {
  const q = prefix.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  // Score each catalog entry. Drop misses (score=0). Stable-sort by score
  // desc — ties keep catalog order (which is the canonical UX ordering).
  const scored = SLASH_COMMANDS.map((c, idx) => ({
    c,
    idx,
    score: scoreCandidate(q, c.name.toLowerCase()),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((x) => x.c);
}

/**
 * Localized HELP text rendered as an in-place assistant message when the user
 * runs `/help`. No LLM call.
 */
export const SLASH_HELP_TEXT = [
  "**可用命令**",
  "",
  ...SLASH_COMMANDS.map((c) => `- \`${c.label}\` — ${c.description}`),
  "",
  "在输入框里直接输入命令并回车即可。",
].join("\n");
