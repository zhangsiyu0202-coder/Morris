// @vitest-environment jsdom
/**
 * Stop / abort button tests for the Morris Conversation input area
 * (work order P1-3).
 *
 * The Conversation component renders a primary "send" button when useChat
 * status is `ready`/`error` and swaps it for a "stop" outline button when
 * status is `submitted` or `streaming`. Clicking stop calls useChat.stop().
 *
 * Follows .kiro/steering/testing.md::Test double pattern §1-2: useChat fake
 * lives in fixtures/use-chat-mock.ts; bind via async factory + dynamic import.
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

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Conversation } from "../conversation";
import { useChatHandle, resetUseChatHandle } from "./fixtures/use-chat-mock";

describe("Conversation — stop / abort button (P1-3)", () => {
  beforeEach(() => {
    resetUseChatHandle();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the send button (no stop) when useChat status is `ready`", () => {
    useChatHandle.state.status = "ready";
    render(<Conversation />);

    expect(screen.getByTestId("assistant-send-button")).toBeTruthy();
    expect(screen.queryByTestId("assistant-stop-button")).toBeNull();
  });

  it("swaps to the stop button when useChat status becomes `streaming`", () => {
    useChatHandle.state.status = "streaming";
    render(<Conversation />);

    expect(screen.getByTestId("assistant-stop-button")).toBeTruthy();
    expect(screen.queryByTestId("assistant-send-button")).toBeNull();
    // accessibility: the icon-only stop button must carry an accessible name.
    expect(screen.getByLabelText("停止")).toBeTruthy();
  });

  it("renders the stop button when useChat status is `submitted` (LLM accepted, not yet streaming)", () => {
    useChatHandle.state.status = "submitted";
    render(<Conversation />);
    expect(screen.getByTestId("assistant-stop-button")).toBeTruthy();
  });

  it("clicking the stop button calls useChat.stop()", () => {
    useChatHandle.state.status = "streaming";
    render(<Conversation />);

    fireEvent.click(screen.getByTestId("assistant-stop-button"));

    expect(useChatHandle.state.stop).toHaveBeenCalledTimes(1);
  });
});
