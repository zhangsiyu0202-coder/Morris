import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  chunkSessionReports,
  mergeThemeAssignments,
  type ThemeAssignments,
} from "../../../apps/functions/analyzeSurvey/src/rollup";

/**
 * P-ANL-08 — chunked rollup 等价性 (Wave F / D15).
 *
 * 1. concat ∘ chunkSessionReports(_, size) === id (无丢失 / 无重复 / 保序)
 * 2. mergeThemeAssignments 字段集层面满足结合律 + 交换律
 * 3. 同一 (themeId, sessionId) 在合并后不重复 (保护 P-ANL-07 mentions 精确性)
 * 4. 单次 vs chunked merge 路径产出在 (themeId → sessionIds 集) 字段集上等价
 */

describe("P-ANL-08: chunkSessionReports concat-id property", () => {
  it("for any items, size>0: chunkSessionReports(items, size).flat() === items", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (items, size) => {
          const chunks = chunkSessionReports(items, size);
          const flat = chunks.flat();
          expect(flat).toEqual(items);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any items: chunkSessionReports([], size) === []", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (size) => {
        expect(chunkSessionReports([] as number[], size)).toEqual([]);
      }),
    );
  });
});

describe("P-ANL-08: mergeThemeAssignments associativity / commutativity (field-set)", () => {
  // Arbitrary for one ThemeAssignments piece: themes from a small id pool, session ids unique within a theme.
  const themeIdArb = fc.constantFrom("t1", "t2", "t3", "t4");
  const sessionIdArb = fc.constantFrom("s1", "s2", "s3", "s4", "s5");

  const pieceArb = fc.array(
    fc.record({
      themeId: themeIdArb,
      sessionIds: fc.uniqueArray(sessionIdArb, { maxLength: 5 }),
      evidenceRefs: fc.constant([] as Array<{ transcriptId: string; segmentIndex: number }>),
    }),
    { maxLength: 5 },
  );

  // Normalize one ThemeAssignments to a canonical map { themeId -> sorted unique sessionIds }
  // for comparison that ignores order.
  const toFieldMap = (x: ThemeAssignments): Record<string, string[]> => {
    const map: Record<string, Set<string>> = {};
    for (const a of x.assignments) {
      if (!map[a.themeId]) map[a.themeId] = new Set();
      for (const s of a.sessionIds) map[a.themeId].add(s);
    }
    return Object.fromEntries(
      Object.entries(map)
        .map(([k, v]) => [k, Array.from(v).sort()])
        .sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
    );
  };

  it("associativity: merge(merge(a,b), c) ≡ merge(a, merge(b,c))", () => {
    fc.assert(
      fc.property(pieceArb, pieceArb, pieceArb, (raw1, raw2, raw3) => {
        const a: ThemeAssignments = { assignments: raw1 };
        const b: ThemeAssignments = { assignments: raw2 };
        const c: ThemeAssignments = { assignments: raw3 };
        const left = mergeThemeAssignments([mergeThemeAssignments([a, b]), c]);
        const right = mergeThemeAssignments([a, mergeThemeAssignments([b, c])]);
        expect(toFieldMap(left)).toEqual(toFieldMap(right));
      }),
      { numRuns: 100 },
    );
  });

  it("commutativity (field-set): merge(a,b) ≡ merge(b,a)", () => {
    fc.assert(
      fc.property(pieceArb, pieceArb, (raw1, raw2) => {
        const a: ThemeAssignments = { assignments: raw1 };
        const b: ThemeAssignments = { assignments: raw2 };
        expect(toFieldMap(mergeThemeAssignments([a, b]))).toEqual(
          toFieldMap(mergeThemeAssignments([b, a])),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("dedupe: any (themeId, sessionId) appears at most once in output", () => {
    fc.assert(
      fc.property(fc.array(pieceArb, { maxLength: 5 }), (rawList) => {
        const out = mergeThemeAssignments(
          rawList.map((r) => ({ assignments: r })),
        );
        for (const a of out.assignments) {
          const set = new Set(a.sessionIds);
          expect(set.size).toBe(a.sessionIds.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("equivalence: chunked merge ≡ single merge (field-set)", () => {
    // Build one big assignments list, then split it into arbitrary chunks
    // and merge - must equal the single-piece merge in field-set.
    fc.assert(
      fc.property(
        pieceArb,
        fc.integer({ min: 1, max: 5 }),
        (raw, chunkSize) => {
          const single: ThemeAssignments = { assignments: raw };
          const chunks = chunkSessionReports(raw, chunkSize).map((r) => ({
            assignments: r,
          }));
          const merged = mergeThemeAssignments(chunks);
          expect(toFieldMap(merged)).toEqual(toFieldMap(single));
        },
      ),
      { numRuns: 100 },
    );
  });
});
