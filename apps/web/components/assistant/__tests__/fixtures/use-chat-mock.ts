/**
 * Shared `useChat` test double for the Morris Conversation component
 * (`stop-and-slash` work order P1-3 + P1-6).
 *
 * Conversation pulls this exact shape from `useChat`:
 *   { messages, sendMessage, status, error, regenerate, clearError, stop, setMessages }
 *
 * The fixture exports a module-level singleton handle. Tests use the
 * `vi.mock("@ai-sdk/react", async () => (await import(this)).useChatMockFactory())`
 * dance documented in `.kiro/steering/testing.md::Test double pattern`, then
 * read the same `useChatHandle` for assertions. `resetUseChatHandle()` between
 * tests clears spy histories without rebuilding the singleton (keeps the
 * Conversation component's reference to the shared `state` valid across the
 * full test file).
 */

import { vi } from "vitest";

export interface UseChatLike {
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    parts: Array<{ type: string; text?: string }>;
  }>;
  status: "ready" | "submitted" | "streaming" | "error";
  error: Error | undefined;
  sendMessage: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  clearError: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setMessages: ReturnType<typeof vi.fn>;
}

function buildState(): UseChatLike {
  const state: UseChatLike = {
    messages: [],
    status: "ready",
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    clearError: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
  };
  return state;
}

/** Install the smart setMessages impl that writes through to useChatHandle.state.
 *  Must be called after useChatHandle is declared (avoids closure-vs-handle
 *  divergence after Object.assign-based reset). */
function installSetMessagesImpl(state: UseChatLike): void {
  state.setMessages.mockImplementation(
    (
      next:
        | UseChatLike["messages"]
        | ((prev: UseChatLike["messages"]) => UseChatLike["messages"]),
    ) => {
      // 写到 useChatHandle.state.messages, 不是 closure-local 的 state.
      // Object.assign reset 后 useChatHandle.state 仍是原对象, .messages 字段
      // 是当前那批; closure 里的 state 是另一个对象. 这里走 handle 才一致.
      useChatHandle.state.messages =
        typeof next === "function" ? next(useChatHandle.state.messages) : next;
    },
  );
}

/**
 * Module-singleton handle. Both the `vi.mock` factory (via dynamic import) and
 * the test file (via static import) resolve to this same module instance, so
 * mutating `useChatHandle.state.status = "streaming"` in a test actually
 * affects what the Conversation component sees on the next render.
 */
export const useChatHandle: { state: UseChatLike } = {
  state: buildState(),
};
installSetMessagesImpl(useChatHandle.state);

/** Reset spy call histories + clear messages list. Call in `beforeEach`. */
export function resetUseChatHandle(): void {
  // Replace the inner state object's fields rather than the object itself, so
  // any closure captured by `vi.mock` continues to read the latest state.
  const fresh = buildState();
  Object.assign(useChatHandle.state, fresh);
  useChatHandle.state.messages = [];
  // Re-install setMessages impl since fresh has a clean spy without mockImpl.
  installSetMessagesImpl(useChatHandle.state);
}

/**
 * Factory passed to `vi.mock("@ai-sdk/react", ...)`. Returns a stable `useChat`
 * stub that always reads from the shared `useChatHandle.state`.
 */
export function useChatMockFactory(): { useChat: () => UseChatLike } {
  return {
    useChat: () => useChatHandle.state,
  };
}
