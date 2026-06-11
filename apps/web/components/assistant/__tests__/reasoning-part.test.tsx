// @vitest-environment jsdom
/**
 * ReasoningPart disclosure tests.
 *
 * Validates the streaming-vs-done branching, default expanded/collapsed state,
 * and the click-to-toggle behavior. Not testing the Markdown render fidelity
 * (covered by markdown.tsx tests) — just the disclosure shell.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { ReasoningPart } from "../reasoning-part";

afterEach(() => cleanup());

describe("ReasoningPart", () => {
  it("streaming state: expanded by default + spinner + body visible", () => {
    render(<ReasoningPart text="thinking…" state="streaming" />);
    const root = screen.getByTestId("reasoning-part");
    expect(root.getAttribute("data-state")).toBe("streaming");
    expect(screen.getByText("Morris 正在思考…")).toBeTruthy();
    expect(screen.getByTestId("reasoning-part-body")).toBeTruthy();
  });

  it("streaming state: header button is disabled (cannot collapse)", () => {
    render(<ReasoningPart text="x" state="streaming" />);
    const btn = screen.getByRole("button");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("done state: collapsed by default — no body visible until click", () => {
    render(<ReasoningPart text="answer thoughts" state="done" />);
    expect(screen.getByText("已思考")).toBeTruthy();
    expect(screen.queryByTestId("reasoning-part-body")).toBeNull();
  });

  it("done state: clicking expands the disclosure", () => {
    render(<ReasoningPart text="step 1, step 2" state="done" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("reasoning-part-body")).toBeTruthy();
  });

  it("done state: clicking again collapses", () => {
    render(<ReasoningPart text="x" state="done" />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByTestId("reasoning-part-body")).toBeNull();
  });

  it("renders aria-expanded that mirrors visible body", () => {
    render(<ReasoningPart text="x" state="done" />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });
});
