// @vitest-environment jsdom
/**
 * ConversationHistory drawer tests (P0-2 / morris-conversation-persistence).
 *
 * Covers all 4 lifecycle states (loading / error / empty / loaded) plus the
 * delete two-step confirm flow. Follows .kiro/steering/testing.md::Test
 * double pattern §1-2 (dynamic-import factory mock; no inline copy-paste).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/conversations/actions", async () => ({
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  createConversation: vi.fn(),
  saveMessages: vi.fn(),
  loadConversation: vi.fn(),
}));

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ConversationHistory } from "../conversation-history";
import * as actions from "@/lib/conversations/actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sampleItems = [
  {
    $id: "c1",
    ownerUserId: "u1",
    title: "调研报告分析",
    messageCount: 6,
    lastMessageAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    lastMessagePreview: "总共发现 3 个主题",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:30:00.000Z",
  },
  {
    $id: "c2",
    ownerUserId: "u1",
    title: "",
    messageCount: 1,
    lastMessageAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    lastMessagePreview: "你好",
    createdAt: "2026-06-11T08:00:00.000Z",
    updatedAt: "2026-06-11T08:00:00.000Z",
  },
];

describe("ConversationHistory", () => {
  it("shows loading state while fetching", () => {
    vi.mocked(actions.listConversations).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    render(<ConversationHistory currentId={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("history-loading")).toBeTruthy();
  });

  it("renders empty state when listConversations returns []", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue([]);
    render(<ConversationHistory currentId={null} onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("history-empty")).toBeTruthy();
    });
  });

  it("renders error banner with retry when listConversations throws", async () => {
    vi.mocked(actions.listConversations).mockRejectedValueOnce(new Error("net down"));
    render(<ConversationHistory currentId={null} onSelect={vi.fn()} />);
    const errEl = await screen.findByTestId("history-error");
    expect(errEl.textContent).toContain("net down");
    // retry: clicking 重试 calls listConversations again
    vi.mocked(actions.listConversations).mockResolvedValueOnce(sampleItems);
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(screen.getByTestId("history-item-c1")).toBeTruthy();
    });
  });

  it("renders items and highlights the active conversation", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue(sampleItems);
    render(<ConversationHistory currentId="c1" onSelect={vi.fn()} />);
    await waitFor(() => screen.getByTestId("history-item-c1"));
    const activeRow = screen.getByTestId("history-item-c1");
    expect(activeRow.getAttribute("aria-current")).toBe("page");
    const inactiveRow = screen.getByTestId("history-item-c2");
    expect(inactiveRow.getAttribute("aria-current")).toBeNull();
  });

  it("clicking a row calls onSelect with that item id", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue(sampleItems);
    const onSelect = vi.fn();
    render(<ConversationHistory currentId="c1" onSelect={onSelect} />);
    await waitFor(() => screen.getByTestId("history-item-c2"));
    fireEvent.click(screen.getByTestId("history-item-c2"));
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("delete button opens inline confirm; confirming calls deleteConversation and removes the row", async () => {
    // First call: returns the row. After deleteConversation invalidates, the
    // component re-fetches via the cross-component channel; second call
    // returns [] to model the server-side removal.
    vi.mocked(actions.listConversations)
      .mockResolvedValueOnce([sampleItems[0]])
      .mockResolvedValueOnce([]);
    vi.mocked(actions.deleteConversation).mockResolvedValue({ ok: true as const });
    render(<ConversationHistory currentId={null} onSelect={vi.fn()} />);
    await waitFor(() => screen.getByTestId("history-item-c1"));
    fireEvent.click(screen.getByTestId("history-delete-c1"));
    // confirm dialog appears
    expect(screen.getByTestId("history-confirm-delete-c1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("history-confirm-yes-c1"));
    await waitFor(() => {
      expect(vi.mocked(actions.deleteConversation)).toHaveBeenCalledWith("c1");
    });
    // row removed from list after confirm
    await waitFor(() => {
      expect(screen.queryByTestId("history-item-c1")).toBeNull();
    });
  });

  it("delete confirm 取消 keeps the row + closes the dialog", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue([sampleItems[0]]);
    render(<ConversationHistory currentId={null} onSelect={vi.fn()} />);
    await waitFor(() => screen.getByTestId("history-item-c1"));
    fireEvent.click(screen.getByTestId("history-delete-c1"));
    fireEvent.click(screen.getByText("取消"));
    expect(screen.queryByTestId("history-confirm-delete-c1")).toBeNull();
    expect(screen.getByTestId("history-item-c1")).toBeTruthy();
    expect(vi.mocked(actions.deleteConversation)).not.toHaveBeenCalled();
  });

  it("close button calls onClose when provided", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue([]);
    const onClose = vi.fn();
    render(<ConversationHistory currentId={null} onSelect={vi.fn()} onClose={onClose} />);
    await waitFor(() => screen.getByTestId("history-empty"));
    fireEvent.click(screen.getByLabelText("关闭历史"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key closes the delete-confirm dialog without deleting", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue([sampleItems[0]]);
    render(<ConversationHistory currentId={null} onSelect={vi.fn()} />);
    await waitFor(() => screen.getByTestId("history-item-c1"));
    fireEvent.click(screen.getByTestId("history-delete-c1"));
    // confirm dialog appears
    expect(screen.getByTestId("history-confirm-delete-c1")).toBeTruthy();
    // Escape closes it without calling deleteConversation
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("history-confirm-delete-c1")).toBeNull();
    });
    expect(vi.mocked(actions.deleteConversation)).not.toHaveBeenCalled();
    // row still in list
    expect(screen.getByTestId("history-item-c1")).toBeTruthy();
  });
});
