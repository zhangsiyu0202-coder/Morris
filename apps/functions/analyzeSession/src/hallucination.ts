/**
 * Hallucination ratio check (analysis-report-v2 R3 / design §6.1).
 *
 * Pure function. Audits the structured LLM output's segmentRefs against the
 * known transcript segment universe. If the ratio of bad refs (pointing to
 * non-existent {transcriptId, segmentIndex} pairs) exceeds the threshold,
 * the handler rejects + retries once with a hallucination hint, and rejects
 * the whole call if the second attempt is also bad — never writes dirty data
 * (P-ANL-05).
 *
 * `validRefs` keys are the canonical "transcriptId#segmentIndex" string.
 * `badRefs` is sliced to the first 10 by callers before persisting to
 * `interview_sessions.errorContext` (D13).
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
  /** Set of "transcriptId#segmentIndex" strings derived from real segments. */
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

export function buildValidRefs(
  transcriptId: string,
  segmentCount: number,
): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < segmentCount; i++) set.add(`${transcriptId}#${i}`);
  return set;
}

export function checkHallucinationRatio(
  args: HallucinationCheckArgs,
): HallucinationCheckResult {
  const allRefs: SegmentRef[] = [];
  for (const t of args.themes) {
    for (const e of t.evidence ?? []) allRefs.push(e);
  }
  for (const c of args.citations) {
    allRefs.push(c.segmentRef);
  }
  const totalRefs = allRefs.length;
  if (totalRefs === 0) {
    // No refs at all → vacuously OK. (Handler 可能想给出更严格策略, 但纯函数不做策略选择)
    return { ratio: 0, ok: true, totalRefs: 0, badRefs: [] };
  }
  const badRefs: SegmentRef[] = [];
  for (const r of allRefs) {
    if (!args.validRefs.has(refKey(r))) badRefs.push(r);
  }
  const ratio = badRefs.length / totalRefs;
  return {
    ratio,
    ok: ratio <= args.threshold,
    totalRefs,
    badRefs,
  };
}
