// @vitest-environment jsdom
/**
 * Slash-command tests for the Morris Conversation input area (work order P1-6).
 *
 * Conversation intercepts inputs starting with `/` BEFORE sendMessage and
 * routes them through handleSlashCommand:
 *   - /clear        → useChat.setMessages([])
 *   - /list         → useChat.sendMessage({ text: "列出我所有的调研" })
 *   - /study <id>   → context-switch sendMessage prompt
 *   - /help         → local-only assistant message via setMessages
 *   - /new          → no-op TODO (subagent A wires createConversation later)
 *   - /foo unknown  → falls through to sendMessage with the literal text
 *
 * Follows .kiro/steering/testing.md::Test double pattern §1-2.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/navigation", async () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

vi.mock("@/lib/conversations/actions", async () => ({
  createConversation: vi.fn(async () => ({ conversationId: "test-conv-id" })),
  saveMessages: vi.fn(async () => ({ ok: true as const })),
  listConversations: vi.fn(async () => []),
  loadConversation: vi.fn(async () => null),
  deleteConversation: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock(
  "@ai-sdk/react",
  async () => (await import("./fixtures/use-chat-mock")).useChatMockFactory(),
);

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Conversation } from "../conversation";
import { useChatHandle, resetUseChatHandle } from "./fixtures/use-chat-mock";

/**
 * Helper: type a value into the textarea and dispatch a plain Enter keydown,
 * which Conversation's onKeyDown maps to submit() (assuming no slash menu nav).
 *
 * Note: when the slash palette is visible, Enter selects the highlighted
 * command via selectSlashCommand, which itself calls submit if the command
 * has no argHint. So /clear, /help, /list, /new behave as if Enter was a
 * direct submit; /study (with argHint) pre-fills and waits for arg.
 */
function typeAndSubmit(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("Conversation — slash commands (P1-6)", () => {
  beforeEach(() => {
    resetUseChatHandle();
  });

  afterEach(() => {
    cleanup();
  });

  it("/clear calls setMessages([]) and does NOT call sendMessage", () => {
    // seed two messages so /clear has something to wipe.
    useChatHandle.state.messages = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "hello" }] },
    ];
    render(<Conversation />);

    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;
    typeAndSubmit(textarea, "/clear");

    expect(useChatHandle.state.setMessages).toHaveBeenCalledTimes(1);
    expect(useChatHandle.state.setMessages).toHaveBeenCalledWith([]);
    expect(useChatHandle.state.sendMessage).not.toHaveBeenCalled();
    // smart fake: the messages list is now empty.
    expect(useChatHandle.state.messages).toEqual([]);
  });

  it("/list calls sendMessage with the canonical 列出我所有的调研 prompt", () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;
    typeAndSubmit(textarea, "/list");

    expect(useChatHandle.state.sendMessage).toHaveBeenCalledTimes(1);
    expect(useChatHandle.state.sendMessage).toHaveBeenCalledWith({
      text: "列出我所有的调研",
    });
    expect(useChatHandle.state.setMessages).not.toHaveBeenCalled();
  });

  it("/study <id> sends a context-switch prompt with the id substituted", () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;
    typeAndSubmit(textarea, "/study s_abc123");

    expect(useChatHandle.state.sendMessage).toHaveBeenCalledTimes(1);
    const call = useChatHandle.state.sendMessage.mock.calls[0]?.[0] as {
      text: string;
    };
    expect(call.text).toContain("s_abc123");
    expect(call.text).toContain("最近 sessions");
  });

  it("/help appends a local assistant message and does NOT call sendMessage", () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;
    typeAndSubmit(textarea, "/help");

    expect(useChatHandle.state.sendMessage).not.toHaveBeenCalled();
    expect(useChatHandle.state.setMessages).toHaveBeenCalledTimes(1);

    // The smart setMessages fake applied the updater. Inspect the result.
    const msgs = useChatHandle.state.messages;
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("assistant");
    const text = msgs[0].parts.map((p) => p.text ?? "").join("");
    expect(text).toContain("/clear");
    expect(text).toContain("/list");
    expect(text).toContain("/help");
  });

  it("unknown command /foo falls through to sendMessage with the literal text", async () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;
    typeAndSubmit(textarea, "/foo bar");

    // /foo is unknown so submit() falls through to sendMessage. submit is async
    // (awaits createConversation on first message) so we wait for the spy.
    await waitFor(() => {
      expect(useChatHandle.state.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(useChatHandle.state.sendMessage).toHaveBeenCalledWith({
      text: "/foo bar",
    });
    expect(useChatHandle.state.setMessages).not.toHaveBeenCalled();
  });

  it("/new is intercepted as a TODO (no sendMessage, no setMessages)", () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;
    typeAndSubmit(textarea, "/new");

    // /new is recognised (not an unknown verb) so it MUST NOT fall through to
    // sendMessage. It also doesn't touch setMessages — the persistence wave
    // (subagent A) wires the real action later.
    expect(useChatHandle.state.sendMessage).not.toHaveBeenCalled();
    expect(useChatHandle.state.setMessages).not.toHaveBeenCalled();
    // input must clear after a recognised slash command consumed it.
    expect(textarea.value).toBe("");
  });

  it("renders the slash-command menu when the input starts with `/` and at least one command matches", () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;

    // empty input → no menu
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();

    // `/` → menu visible, all 5 commands listed
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
    expect(screen.getByTestId("slash-command-item-help")).toBeTruthy();
    expect(screen.getByTestId("slash-command-item-clear")).toBeTruthy();

    // `/h` narrows to /help
    fireEvent.change(textarea, { target: { value: "/h" } });
    expect(screen.getByTestId("slash-command-item-help")).toBeTruthy();
    expect(screen.queryByTestId("slash-command-item-clear")).toBeNull();
  });

  it("hides the slash-command menu when the prefix matches no command", () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "/zzz" } });
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();
  });

  it("Escape clears the slash input when the menu is open", () => {
    render(<Conversation />);
    const textarea = screen.getByPlaceholderText(
      "问我任何关于你调研的问题…",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "/he" } });
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(textarea.value).toBe("");
  });
});
