// @vitest-environment jsdom
/**
 * HistoryPreview start-page card grid tests.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/conversations/actions", async () => ({
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  createConversation: vi.fn(),
  saveMessages: vi.fn(),
  loadConversation: vi.fn(),
}));

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HistoryPreview } from "../history-preview";
import * as actions from "@/lib/conversations/actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const items = [
  {
    $id: "c1",
    ownerUserId: "u1",
    title: "调研 A",
    messageCount: 4,
    lastMessageAt: new Date(Date.now() - 60_000).toISOString(),
    lastMessagePreview: "preview a",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
  },
  {
    $id: "c2",
    ownerUserId: "u1",
    title: "",
    messageCount: 1,
    lastMessageAt: new Date(Date.now() - 3600_000).toISOString(),
    lastMessagePreview: "preview b",
    createdAt: "2026-06-11T09:00:00.000Z",
    updatedAt: "2026-06-11T09:00:00.000Z",
  },
];

describe("HistoryPreview", () => {
  it("returns null while loading (welcome screen stays clean)", () => {
    vi.mocked(actions.listConversations).mockImplementation(
      () => new Promise(() => {}),
    );
    const { container } = render(<HistoryPreview onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when no conversations exist (empty welcome)", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue([]);
    const { container } = render(<HistoryPreview onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders cards for up to `limit` conversations", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue(items);
    render(<HistoryPreview onSelect={vi.fn()} limit={2} />);
    await waitFor(() => {
      expect(screen.getByTestId("preview-card-c1")).toBeTruthy();
      expect(screen.getByTestId("preview-card-c2")).toBeTruthy();
    });
  });

  it("title fallback to '新对话' when title is empty", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue([items[1]]);
    render(<HistoryPreview onSelect={vi.fn()} />);
    await waitFor(() => screen.getByTestId("preview-card-c2"));
    expect(screen.getByTestId("preview-card-c2").textContent).toContain("新对话");
  });

  it("clicking a card calls onSelect with the id", async () => {
    vi.mocked(actions.listConversations).mockResolvedValue(items);
    const onSelect = vi.fn();
    render(<HistoryPreview onSelect={onSelect} />);
    await waitFor(() => screen.getByTestId("preview-card-c1"));
    fireEvent.click(screen.getByTestId("preview-card-c1"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });
});
