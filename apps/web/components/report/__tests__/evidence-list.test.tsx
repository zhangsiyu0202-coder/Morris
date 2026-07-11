// @vitest-environment jsdom
/**
 * EvidenceList — citations renderer for the survey-level analysis report.
 *
 * Covers:
 *  - empty citations → renders nothing
 *  - single citation → quote / theme label / sentiment / segment ref all surface
 *  - multiple citations → all render, preserving order
 *  - unknown themeId → graceful degrade (citation still renders, no theme tag)
 *  - a11y → quote wrapped in <blockquote>, each citation is a list item
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EvidenceList } from "../evidence-list";

afterEach(() => cleanup());

type Sentiment = "positive" | "neutral" | "negative";

function theme(overrides: {
  id: string;
  label?: string;
  mentions?: number;
  pct?: number;
  sentiment?: Sentiment;
}) {
  return {
    id: overrides.id,
    label: overrides.label ?? "用户期望",
    mentions: overrides.mentions ?? 5,
    pct: overrides.pct ?? 25,
    sentiment: overrides.sentiment ?? ("positive" as const),
  };
}

function citation(overrides: {
  transcriptId?: string;
  segmentIndex?: number;
  quote?: string;
  themeIds?: string[];
}) {
  return {
    segmentRef: {
      transcriptId: overrides.transcriptId ?? "tr-123",
      segmentIndex: overrides.segmentIndex ?? 5,
    },
    quote: overrides.quote ?? "I really expected a different flow here.",
    themeIds: overrides.themeIds ?? ["t1"],
  };
}

describe("EvidenceList", () => {
  it("renders nothing when there are no citations", () => {
    const { container } = render(
      <EvidenceList citations={[]} themes={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders quote, theme label, sentiment tag, and segment ref for one citation", () => {
    render(
      <EvidenceList
        citations={[citation({})]}
        themes={[theme({ id: "t1", label: "用户期望", sentiment: "positive" })]}
      />,
    );
    // quote body
    expect(screen.getByText(/I really expected/)).toBeTruthy();
    // theme label
    expect(screen.getByText("用户期望")).toBeTruthy();
    // sentiment tag — Chinese label comes from SENTIMENT_LABEL in shared.tsx
    expect(screen.getByText("正面")).toBeTruthy();
    // segment ref
    expect(screen.getByText(/tr-123 · 段 5/)).toBeTruthy();
  });

  it("renders all citations preserving order and resolves themeIds to themes", () => {
    const themes = [
      theme({ id: "t1", label: "用户期望", sentiment: "positive" }),
      theme({ id: "t2", label: "服务流程", sentiment: "negative" }),
    ];
    const citations = [
      citation({
        transcriptId: "alpha",
        segmentIndex: 1,
        quote: "First quote",
        themeIds: ["t1"],
      }),
      citation({
        transcriptId: "bravo",
        segmentIndex: 2,
        quote: "Second quote",
        themeIds: ["t2"],
      }),
    ];
    render(<EvidenceList citations={citations} themes={themes} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // order preserved
    expect(items[0]?.textContent).toContain("First quote");
    expect(items[1]?.textContent).toContain("Second quote");
    // theme labels rendered
    expect(screen.getByText("用户期望")).toBeTruthy();
    expect(screen.getByText("服务流程")).toBeTruthy();
    // sentiment labels both rendered
    expect(screen.getByText("正面")).toBeTruthy();
    expect(screen.getByText("负面")).toBeTruthy();
  });

  it("degrades gracefully when a citation's themeId is not in the themes set", () => {
    render(
      <EvidenceList
        citations={[citation({ themeIds: ["t1", "missing"] })]}
        themes={[theme({ id: "t1", label: "用户期望", sentiment: "positive" })]}
      />,
    );
    // quote + segment ref still render
    expect(screen.getByText(/I really expected/)).toBeTruthy();
    expect(screen.getByText(/tr-123 · 段 5/)).toBeTruthy();
    // the known theme is rendered, the missing one is silently skipped
    expect(screen.getByText("用户期望")).toBeTruthy();
    expect(screen.queryByText("missing")).toBeNull();
  });

  it("wraps the quote in a <blockquote> element for accessibility", () => {
    const { container } = render(
      <EvidenceList
        citations={[citation({})]}
        themes={[theme({ id: "t1" })]}
      />,
    );
    const bq = container.querySelector("blockquote");
    expect(bq).toBeTruthy();
    expect(bq?.textContent).toContain("I really expected");
  });
});
