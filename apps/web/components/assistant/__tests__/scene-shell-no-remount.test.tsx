// @vitest-environment jsdom
/**
 * Regression test for "first-turn lazy-create makes Morris UI vanish" bug.
 *
 * Symptoms before the fix:
 *   - User opens /assistant (no conversationId in URL → welcome screen).
 *   - User clicks a suggestion or types a message → submit() calls
 *     createConversation → setCurrentId → router.replace(?conversationId=X).
 *   - Router.replace triggers an RSC re-render of AssistantPage. The new
 *     conversationId prop propagates down to AssistantSceneShell, which
 *     previously rendered `<Conversation key={conversationId ?? "welcome"}>`.
 *   - That key flips from "welcome" → newId → React unmounts the old
 *     Conversation and mounts a new one. The in-flight useChat state
 *     (the user message just added + the assistant reply that's mid-stream)
 *     gets thrown away. RSC's loadConversation(newId) returns null because
 *     saveMessages hasn't completed yet, so the new Conversation re-seeds
 *     with empty messages and shows the welcome screen + HistoryPreview.
 *   - User sees their just-typed message disappear, even though it (and the
 *     eventual assistant reply) DID persist to Appwrite via onFinish.
 *
 * Fix: drop the `key={conversationId}` from AssistantSceneShell and from
 * AssistantDock. Conversation now reconciles conversationId prop changes
 * internally via a useEffect that only resets useChat state when the prop
 * truly diverges from the internal `currentId` (i.e. a real conversation
 * switch from history, not a lazy-create id assignment).
 *
 * This test guards the key removal by mounting AssistantSceneShell with
 * `conversationId={null}`, then re-rendering with a non-null value, and
 * asserting that the Conversation mock instance is NOT remounted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/assistant",
}));

vi.mock("@/lib/conversations/actions", () => ({
  createConversation: vi.fn(async () => ({ conversationId: "lazy-id" })),
  saveMessages: vi.fn(async () => ({ ok: true as const })),
  listConversations: vi.fn(async () => []),
  loadConversation: vi.fn(async () => null),
  deleteConversation: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("../use-conversations", () => ({
  useInvalidateConversations: () => vi.fn(async () => undefined),
  useConversations: () => ({ data: [], error: undefined, isLoading: false, mutate: vi.fn() }),
}));

let mountCount = 0;
let unmountCount = 0;
let lastPropsReceived: { conversationId?: string } | null = null;

function MockConversation(props: { conversationId?: string }) {
  // Track mount/unmount with a useEffect cleanup pair. mountCount increments
  // on every fresh mount; unmountCount on every cleanup. If the parent uses
  // key={conversationId}, key change unmount + remount → both counters bump.
  useEffect(() => {
    mountCount += 1;
    return () => {
      unmountCount += 1;
    };
  }, []);
  lastPropsReceived = props;
  return <div data-testid="mock-conversation">conv={props.conversationId ?? "null"}</div>;
}

vi.mock("../conversation", () => ({
  Conversation: MockConversation,
}));

// SWRConfig isolation per render (per testing.md guidance for SWR consumers).
import { render, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import { AssistantSceneShell } from "../assistant-scene-shell";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  );
}

describe("AssistantSceneShell — no remount on lazy-create id assignment", () => {
  beforeEach(() => {
    mountCount = 0;
    unmountCount = 0;
    lastPropsReceived = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts Conversation exactly once when conversationId changes null → string", () => {
    const { rerender } = render(
      <Wrapper>
        <AssistantSceneShell conversationId={null} />
      </Wrapper>,
    );
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    expect(lastPropsReceived?.conversationId).toBeUndefined();

    // Simulate the lazy-create path: parent re-renders with the newly-minted id.
    rerender(
      <Wrapper>
        <AssistantSceneShell conversationId="lazy-id" />
      </Wrapper>,
    );

    // Before the fix this asserted mountCount === 2 / unmountCount === 1 because
    // `<Conversation key={conversationId ?? "welcome"}>` flipped key on the
    // null → "lazy-id" transition and tore down + remounted Conversation,
    // wiping useChat's in-flight state.
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    // But the new conversationId IS passed through as a prop so Conversation
    // can reconcile via its internal useEffect.
    expect(lastPropsReceived?.conversationId).toBe("lazy-id");
  });

  it("mounts Conversation exactly once when conversationId changes between two strings", () => {
    // Simulates a history switch: id1 → id2. With the old key= approach this
    // forced a remount (which was the intended behavior — load id2's persisted
    // messages). With the fix, Conversation no longer remounts; instead its
    // internal useEffect compares the new prop to currentId and resets
    // useChat state via setMessages(initialMessages) when they diverge.
    // This test guards "no remount"; the message-reset behavior is tested
    // in conversation.test.tsx via the useChat mock.
    const { rerender } = render(
      <Wrapper>
        <AssistantSceneShell conversationId="id-1" />
      </Wrapper>,
    );
    expect(mountCount).toBe(1);

    rerender(
      <Wrapper>
        <AssistantSceneShell conversationId="id-2" />
      </Wrapper>,
    );

    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    expect(lastPropsReceived?.conversationId).toBe("id-2");
  });
});
