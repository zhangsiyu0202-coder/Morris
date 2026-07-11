/**
 * generateConversationTitle tests — covers retry-once-after-5s + success +
 * empty-message skip + double-failure swallow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", async () => ({
  generateText: vi.fn(),
}));
vi.mock("@/lib/assistant/model", async () => ({
  CHAT_MODEL: { provider: "test", modelId: "test" },
}));
vi.mock("../server", async () => ({
  saveTitle: vi.fn(async () => undefined),
  loadConversationDoc: vi.fn(async () => ({
    $id: "conv-1",
    ownerUserId: "u1",
    title: "",
    messagesJson: "[]",
    messageCount: 1,
    lastMessageAt: "2026-06-11T00:00:00.000Z",
    lastMessagePreview: "",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  })),
}));
vi.mock("@/lib/queries/auth", async () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
}));
vi.mock("@merism/observability", async () => {
  const real = await vi.importActual<typeof import("@merism/observability")>(
    "@merism/observability",
  );
  return {
    ...real,
    withLLMCall: vi.fn(async (_opts, fn) => fn()),
    createLogger: vi.fn(() => ({
      traceId: "trace-test",
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

import * as ai from "ai";
import * as server from "../server";

const sampleMsg = {
  role: "user" as const,
  parts: [{ type: "text" as const, text: "我想分析受访者对结账体验的反馈" }],
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("generateConversationTitle", () => {
  it("happy path: generates + saves title from first user message", async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce({
      text: "结账体验分析",
    } as Awaited<ReturnType<typeof ai.generateText>>);

    const { generateConversationTitle } = await import("../title");
    await generateConversationTitle("conv-1", sampleMsg);

    expect(vi.mocked(ai.generateText)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(server.saveTitle)).toHaveBeenCalledWith(
      "conv-1",
      "结账体验分析",
    );
  });

  it("empty user message: skips both LLM and saveTitle", async () => {
    const { generateConversationTitle } = await import("../title");
    await generateConversationTitle("conv-1", { role: "user", parts: [] });

    expect(vi.mocked(ai.generateText)).not.toHaveBeenCalled();
    expect(vi.mocked(server.saveTitle)).not.toHaveBeenCalled();
  });

  it("retry: first attempt fails, second succeeds after 5s sleep", async () => {
    vi.mocked(ai.generateText)
      .mockRejectedValueOnce(new Error("503 deepseek down"))
      .mockResolvedValueOnce({
        text: "结账体验分析",
      } as Awaited<ReturnType<typeof ai.generateText>>);

    const { generateConversationTitle } = await import("../title");
    const promise = generateConversationTitle("conv-1", sampleMsg);

    // First attempt rejects; advance fake timer past the 5s retry sleep.
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    expect(vi.mocked(ai.generateText)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(server.saveTitle)).toHaveBeenCalledWith(
      "conv-1",
      "结账体验分析",
    );
  });

  it("double failure: swallows + does not throw + does not save title", async () => {
    vi.mocked(ai.generateText)
      .mockRejectedValueOnce(new Error("attempt 1"))
      .mockRejectedValueOnce(new Error("attempt 2"));

    const { generateConversationTitle } = await import("../title");
    const promise = generateConversationTitle("conv-1", sampleMsg);
    await vi.advanceTimersByTimeAsync(5_000);

    // does NOT throw — caller is fire-and-forget
    await expect(promise).resolves.toBeUndefined();
    expect(vi.mocked(ai.generateText)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(server.saveTitle)).not.toHaveBeenCalled();
  });

  it("ownership check: cross-owner conversationId silently skips title gen", async () => {
    const auth = await import("@/lib/queries/auth");
    const server = await import("../server");
    vi.mocked(auth.getCurrentUserId).mockResolvedValueOnce("attacker");
    vi.mocked(server.loadConversationDoc).mockResolvedValueOnce({
      $id: "victim-conv",
      ownerUserId: "victim", // different from attacker
      title: "",
      messagesJson: "[]",
      messageCount: 1,
      lastMessageAt: "2026-06-11T00:00:00.000Z",
      lastMessagePreview: "",
      createdAt: "2026-06-11T00:00:00.000Z",
      updatedAt: "2026-06-11T00:00:00.000Z",
    });

    const { generateConversationTitle } = await import("../title");
    await generateConversationTitle("victim-conv", sampleMsg);

    expect(vi.mocked(ai.generateText)).not.toHaveBeenCalled();
    expect(vi.mocked(server.saveTitle)).not.toHaveBeenCalled();
  });

  it("not signed in: skips silently", async () => {
    const auth = await import("@/lib/queries/auth");
    vi.mocked(auth.getCurrentUserId).mockResolvedValueOnce(null);
    const { generateConversationTitle } = await import("../title");
    await generateConversationTitle("conv-1", sampleMsg);
    expect(vi.mocked(ai.generateText)).not.toHaveBeenCalled();
  });

  it("LLM returns empty text: does not call saveTitle", async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce({
      text: "   ",
    } as Awaited<ReturnType<typeof ai.generateText>>);

    const { generateConversationTitle } = await import("../title");
    await generateConversationTitle("conv-1", sampleMsg);

    expect(vi.mocked(server.saveTitle)).not.toHaveBeenCalled();
  });
});
