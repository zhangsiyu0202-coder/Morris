/**
 * Hallucination ratio check for analyzeSurvey (analysis-report-v2 R3 / design §6).
 *
 * Mirrors apps/functions/analyzeSession/src/hallucination.ts but the
 * `validRefs` source is *the union of all session-level reports' citations
 * and theme evidence* (design §6.4) — survey-level rollup must not invent
 * segmentRefs that don't appear in any session-level report.
 *
 * Pure function. Same shape as analyzeSession; we keep two physical files so
 * each Function stays self-contained (small price for module isolation).
 */

interface SegmentRef {
  transcriptId: string;
  segmentIndex: number;
}

interface ThemeWithEvidence {
  evidence?: SegmentRef[];
}

interface CitationWithRef {
  segmentRef: SegmentRef;
}

export interface HallucinationCheckArgs {
  themes: ThemeWithEvidence[];
  citations: CitationWithRef[];
  validRefs: Set<string>;
  threshold: number;
}

export interface HallucinationCheckResult {
  ratio: number;
  ok: boolean;
  totalRefs: number;
  badRefs: SegmentRef[];
}

export function refKey(r: SegmentRef): string {
  return `${r.transcriptId}#${r.segmentIndex}`;
}

/**
 * Build the validRefs union from all session-level report citations + theme
 * evidence. Inputs are accepted as `unknown[]` (the report fields come from
 * Appwrite's parseJson layer in the deps) and runtime-validated; non-matching
 * entries are silently skipped (they will surface as bad refs later if the
 * LLM uses them anyway).
 */
export function buildValidRefsFromSessionReports(
  reports: ReadonlyArray<{ citations: unknown[]; themes: unknown[] }>,
): Set<string> {
  const set = new Set<string>();
  for (const r of reports) {
    for (const cRaw of r.citations) {
      const c = cRaw as { segmentRef?: SegmentRef };
      if (
        c?.segmentRef &&
        typeof c.segmentRef.transcriptId === "string" &&
        typeof c.segmentRef.segmentIndex === "number"
      ) {
        set.add(refKey(c.segmentRef));
      }
    }
    for (const tRaw of r.themes) {
      const t = tRaw as { evidence?: SegmentRef[] };
      for (const e of t?.evidence ?? []) {
        if (typeof e?.transcriptId === "string" && typeof e?.segmentIndex === "number") {
          set.add(refKey(e));
        }
      }
    }
  }
  return set;
}

export function checkHallucinationRatio(
  args: HallucinationCheckArgs,
): HallucinationCheckResult {
  const allRefs: SegmentRef[] = [];
  for (const t of args.themes) for (const e of t.evidence ?? []) allRefs.push(e);
  for (const c of args.citations) allRefs.push(c.segmentRef);
  const totalRefs = allRefs.length;
  if (totalRefs === 0) {
    return { ratio: 0, ok: true, totalRefs: 0, badRefs: [] };
  }
  const badRefs: SegmentRef[] = [];
  for (const r of allRefs) {
    if (!args.validRefs.has(refKey(r))) badRefs.push(r);
  }
  const ratio = badRefs.length / totalRefs;
  return { ratio, ok: ratio <= args.threshold, totalRefs, badRefs };
}
