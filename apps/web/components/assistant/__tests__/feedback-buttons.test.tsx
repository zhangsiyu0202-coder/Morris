// @vitest-environment jsdom
/**
 * FeedbackButtons disclosure tests.
 *
 * Covers the 5 phase transitions: idle → (up) → rated_up; idle → (down) →
 * rating_down_text → (submit) → rated_down; idle → null when conversationId
 * is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/conversations/feedback", async () => ({
  submitFeedback: vi.fn(async () => ({ ok: true as const })),
  FeedbackRatingSchema: { _def: {} },
}));

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { FeedbackButtons } from "../feedback-buttons";
import * as feedback from "@/lib/conversations/feedback";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("FeedbackButtons", () => {
  it("returns null when conversationId is missing (no phantom feedback)", () => {
    const { container } = render(
      <FeedbackButtons conversationId={null} messageId="m1" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("idle phase: renders both up + down thumbs", () => {
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    expect(screen.getByLabelText("觉得有帮助")).toBeTruthy();
    expect(screen.getByLabelText("觉得不准 / 想反馈")).toBeTruthy();
  });

  it("clicking up: submits rating='up' and switches to rated state", async () => {
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    fireEvent.click(screen.getByLabelText("觉得有帮助"));
    await waitFor(() => {
      expect(screen.getByTestId("feedback-rated")).toBeTruthy();
    });
    expect(vi.mocked(feedback.submitFeedback)).toHaveBeenCalledWith({
      conversationId: "c1",
      messageId: "m1",
      rating: "up",
      feedbackText: undefined,
    });
  });

  it("clicking down: opens text-prompt phase (does NOT submit yet)", () => {
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    fireEvent.click(screen.getByLabelText("觉得不准 / 想反馈"));
    expect(screen.getByTestId("feedback-down-text")).toBeTruthy();
    expect(vi.mocked(feedback.submitFeedback)).not.toHaveBeenCalled();
  });

  it("down → submit text: sends rating='down' with trimmed feedbackText", async () => {
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    fireEvent.click(screen.getByLabelText("觉得不准 / 想反馈"));
    const textarea = screen.getByLabelText("反馈内容 (可选)") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  not what I asked  " } });
    fireEvent.click(screen.getByText("提交"));
    await waitFor(() => {
      expect(screen.getByTestId("feedback-rated")).toBeTruthy();
    });
    expect(vi.mocked(feedback.submitFeedback)).toHaveBeenCalledWith({
      conversationId: "c1",
      messageId: "m1",
      rating: "down",
      feedbackText: "not what I asked",
    });
  });

  it("down → cancel: returns to idle without submitting", () => {
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    fireEvent.click(screen.getByLabelText("觉得不准 / 想反馈"));
    fireEvent.click(screen.getByLabelText("取消"));
    expect(screen.queryByTestId("feedback-down-text")).toBeNull();
    expect(screen.getByTestId("feedback-idle")).toBeTruthy();
    expect(vi.mocked(feedback.submitFeedback)).not.toHaveBeenCalled();
  });

  it("Escape in textarea: cancels back to idle", () => {
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    fireEvent.click(screen.getByLabelText("觉得不准 / 想反馈"));
    const textarea = screen.getByLabelText("反馈内容 (可选)");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByTestId("feedback-down-text")).toBeNull();
  });

  it("Enter in textarea: submits (without Shift)", async () => {
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    fireEvent.click(screen.getByLabelText("觉得不准 / 想反馈"));
    const textarea = screen.getByLabelText("反馈内容 (可选)");
    fireEvent.change(textarea, { target: { value: "missed citation" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => {
      expect(screen.getByTestId("feedback-rated")).toBeTruthy();
    });
    expect(vi.mocked(feedback.submitFeedback)).toHaveBeenCalledWith({
      conversationId: "c1",
      messageId: "m1",
      rating: "down",
      feedbackText: "missed citation",
    });
  });

  it("submitFeedback throws: stays in idle and shows error", async () => {
    vi.mocked(feedback.submitFeedback).mockRejectedValueOnce(new Error("network"));
    render(<FeedbackButtons conversationId="c1" messageId="m1" />);
    fireEvent.click(screen.getByLabelText("觉得有帮助"));
    await waitFor(() => {
      expect(screen.queryByTestId("feedback-rated")).toBeNull();
      expect(screen.getByText("network")).toBeTruthy();
    });
  });
});
