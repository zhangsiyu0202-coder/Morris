import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  enrichSurveyThemes,
  type ExtractedTheme,
  type ThemeAssignment,
} from "../../../apps/functions/analyzeSurvey/src/rollup";

/**
 * P-ANL-07 — 二段式 rollup mentions/pct 精确性
 *
 * 对任意 (themes, assignments, totalSessions):
 *   - mentions(theme_i) ≡ assignments[i].sessionIds.length  (P-ANL-07 严格)
 *   - pct ≡ round(mentions / total × 100, 2),范围 [0, 100]
 *   - sum(pct/100) ≤ 1.0 + small slack  (P-ANL-04 兼容)
 *   - mentions === 0 的 theme 必从输出中过滤掉
 *   - themes 落库形态严格 = { id, label, mentions, pct } 四字段 (C1 修订)
 */

describe("P-ANL-07: enrichSurveyThemes mentions/pct exactness", () => {
  // Generate consistent themes + assignments aligned by id.
  const buildArbs = (totalSessions: number) =>
    fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 8 })
      .chain((ids) =>
        fc.tuple(
          fc.constant(ids),
          // For each themeId, generate a sessionIds list (subset of 0..total-1)
          fc.array(
            fc
              .uniqueArray(
                fc.integer({ min: 0, max: Math.max(0, totalSessions - 1) }),
                { maxLength: totalSessions },
              )
              .map((nums) => nums.map((n) => `s${n}`)),
            { minLength: ids.length, maxLength: ids.length },
          ),
        ),
      );

  it("mentions equals sessionIds.length, pct = mentions/total × 100", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }).chain((totalSessions) =>
          buildArbs(totalSessions).map(([ids, lists]) => ({ totalSessions, ids, lists })),
        ),
        ({ totalSessions, ids, lists }) => {
          const themes: ExtractedTheme[] = ids.map((id) => ({ id, label: id, description: "" }));
          const assignments: ThemeAssignment[] = ids.map((id, i) => ({
            themeId: id,
            sessionIds: lists[i] ?? [],
            evidenceRefs: [],
          }));
          const enriched = enrichSurveyThemes(themes, assignments, totalSessions);

          for (const t of enriched.themes) {
            const a = assignments.find((x) => x.themeId === t.id)!;
            expect(t.mentions).toBe(a.sessionIds.length);
            expect(t.mentions).toBeGreaterThan(0);
            expect(t.pct).toBeGreaterThanOrEqual(0);
            expect(t.pct).toBeLessThanOrEqual(100);
            expect(Object.keys(t).sort()).toEqual(["id", "label", "mentions", "pct"]);
          }
          const totalShare = enriched.themes.reduce((s, t) => s + t.pct / 100, 0);
          expect(totalShare).toBeLessThanOrEqual(1.0 + 1e-2);

          const expectedNonZero = assignments.filter((a) => a.sessionIds.length > 0).length;
          expect(enriched.themes.length).toBe(expectedNonZero);

          expect(enriched.themeContexts.map((c) => c.id)).toEqual(
            enriched.themes.map((t) => t.id),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("totalSessions === 0 → all themes pct=0 (no divide-by-zero)", () => {
    const themes: ExtractedTheme[] = [
      { id: "t1", label: "x", description: "x" },
    ];
    const assignments: ThemeAssignment[] = [
      { themeId: "t1", sessionIds: ["s1"], evidenceRefs: [] },
    ];
    const out = enrichSurveyThemes(themes, assignments, 0);
    expect(out.themes[0].pct).toBe(0);
    expect(out.themes[0].mentions).toBe(1);
  });
});
