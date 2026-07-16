// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { RankedFindingsSection } from "../ranked-findings-section";

afterEach(() => cleanup());

const themes = [
  { id: "theme-pricing", label: "隐藏费用", mentions: 8, pct: 80, sentiment: "negative" as const },
];

const insights = [
  {
    id: "insight-trust",
    title: "意外费用会损害信任",
    text: "受访者在结账末尾看到额外收费后放弃购买。",
    confidence: 0.91,
    supportingThemeIds: ["theme-pricing"],
  },
];

describe("RankedFindingsSection", () => {
  it("renders nothing when this is a historic report without reranking", () => {
    const { container } = render(
      <RankedFindingsSection rankedFindings={undefined} themes={themes} insights={insights} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a semantic ranked list with the original evidence statistics", () => {
    render(
      <RankedFindingsSection
        themes={themes}
        insights={insights}
        rankedFindings={[
          { kind: "insight", sourceId: "insight-trust", rank: 1, relevanceScore: 0.96 },
          { kind: "theme", sourceId: "theme-pricing", rank: 2, relevanceScore: 0.81 },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "优先发现" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("意外费用会损害信任");
    expect(items[0]?.textContent).toContain("模型相关度 96%");
    expect(items[1]?.textContent).toContain("隐藏费用");
    expect(items[1]?.textContent).toContain("8 人 · 80%");
  });

  it("degrades safely when a stale source slips past storage validation", () => {
    render(
      <RankedFindingsSection
        themes={themes}
        insights={insights}
        rankedFindings={[
          { kind: "insight", sourceId: "missing", rank: 1, relevanceScore: 0.99 },
          { kind: "theme", sourceId: "theme-pricing", rank: 2, relevanceScore: 0.81 },
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("missing")).toBeNull();
  });
});
