// @vitest-environment jsdom
/**
 * Regression test for "listStudies card shows NaN%" bug.
 *
 * Symptoms before the fix:
 *   - `listStudies` tool's artifact schema: { id, title, status, version, updatedAt }
 *     (no `responses`, no `completionRate`).
 *   - `StudyListCard`'s render assumed: { id, title, status, responses, completionRate }
 *     and rendered `{Math.round(s.completionRate * 100)}%` →
 *     `Math.round(undefined * 100)` → `NaN%`.
 *   - It also assumed status ∈ {"draft", "live", "closed"} while the actual
 *     Survey.status enum is {"draft", "published", "paused", "closed", "archived"},
 *     causing STATUS_LABEL lookup to be undefined for "published" / "paused" /
 *     "archived" and rendering the raw English enum value instead of zh.
 *
 * Fix:
 *   - StudyList type now matches the tool's actual artifact (status: string,
 *     adds version + updatedAt, drops responses + completionRate).
 *   - Sub-line renders "v{version} · 更新于 {date}" instead of NaN math.
 *   - STATUS_LABEL covers all 5 SurveyStatus values + fallback to raw on miss.
 *
 * This test reproduces the input the tool actually emits and asserts no NaN
 * appears anywhere in the rendered output + the zh status label is used.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StudyListCard } from "../tool-results";

describe("StudyListCard — listStudies artifact rendering (NaN% regression)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders version + updatedAt without NaN, even though responses/completionRate are absent", () => {
    // Exactly what listStudies tool returns (Survey[] mapped to artifact).
    const artifact = {
      studies: [
        {
          id: "s1",
          title: "Pressure Survey",
          status: "published",
          version: 1,
          updatedAt: "2026-06-17T12:34:56.000Z",
        },
      ],
    };
    render(<StudyListCard data={artifact} />);

    // Title is visible.
    expect(screen.getByText("Pressure Survey")).toBeTruthy();
    // Sub-line shows v1 + formatted date (YYYY-MM-DD).
    expect(screen.getByText(/v1 · 更新于 2026-06-17/)).toBeTruthy();
    // CRITICAL: no NaN anywhere in the card.
    const cardText = document.body.textContent ?? "";
    expect(cardText).not.toContain("NaN");
    expect(cardText).not.toContain("undefined");
  });

  it("renders zh label for every SurveyStatus value (full enum coverage)", () => {
    const statuses = [
      { id: "1", title: "草稿调研", status: "draft", version: 1, updatedAt: "2026-06-01T00:00:00Z" },
      { id: "2", title: "进行中调研", status: "published", version: 2, updatedAt: "2026-06-02T00:00:00Z" },
      { id: "3", title: "暂停调研", status: "paused", version: 1, updatedAt: "2026-06-03T00:00:00Z" },
      { id: "4", title: "已结束调研", status: "closed", version: 3, updatedAt: "2026-06-04T00:00:00Z" },
      { id: "5", title: "归档调研", status: "archived", version: 2, updatedAt: "2026-06-05T00:00:00Z" },
    ];
    render(<StudyListCard data={{ studies: statuses }} />);

    expect(screen.getByText("草稿")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(screen.getByText("已暂停")).toBeTruthy();
    expect(screen.getByText("已结束")).toBeTruthy();
    expect(screen.getByText("已归档")).toBeTruthy();
    // No raw English enum value should leak through (would happen if
    // STATUS_LABEL lookup were missing one).
    const cardText = document.body.textContent ?? "";
    expect(cardText).not.toContain("published");
    expect(cardText).not.toContain("paused");
    expect(cardText).not.toContain("archived");
  });

  it("falls back to '—' for invalid / missing updatedAt (defensive date parse)", () => {
    const artifact = {
      studies: [
        {
          id: "x",
          title: "Broken Survey",
          status: "draft",
          version: 0,
          updatedAt: "", // empty / sentinel from upstream
        },
      ],
    };
    render(<StudyListCard data={artifact} />);
    expect(screen.getByText(/v0 · 更新于 —/)).toBeTruthy();
    const cardText = document.body.textContent ?? "";
    expect(cardText).not.toContain("Invalid Date");
    expect(cardText).not.toContain("NaN");
  });

  it("gracefully renders an unknown status code without crashing", () => {
    // If listStudies ever surfaces a status enum we haven't translated yet,
    // we want the raw value, not undefined or a runtime error.
    const artifact = {
      studies: [
        {
          id: "z",
          title: "Future Status",
          status: "unreleased_future_state",
          version: 1,
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    };
    render(<StudyListCard data={artifact} />);
    expect(screen.getByText("unreleased_future_state")).toBeTruthy();
  });
});
