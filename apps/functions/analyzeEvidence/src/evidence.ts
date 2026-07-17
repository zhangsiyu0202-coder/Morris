import {
  ResearchEvidenceClaimTypeSchema,
  ResearchEvidenceStanceSchema,
} from "@merism/contracts";
import { z } from "zod";

export const EVIDENCE_EXTRACTION_BATCH_SIZE = 20;
export const MAX_CLAIMS_PER_SOURCE_SEGMENT = 3;

export interface TranscriptSegment {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface EvidenceSourceSegment {
  segmentIndex: number;
  sourceText: string;
  /**
   * The immediately preceding moderator utterance, when the transcript has
   * one. It is context, not a guessed Survey question id: current LiveKit
   * transcripts do not carry a question-id-to-segment mapping.
   */
  questionText: string;
}

export const AtomicClaimSchema = z.object({
  segmentIndex: z.number().int().nonnegative(),
  claim: z.string().trim().min(1).max(4_000),
  claimType: ResearchEvidenceClaimTypeSchema,
  stance: ResearchEvidenceStanceSchema,
});
export type AtomicClaim = z.infer<typeof AtomicClaimSchema>;

export const EvidenceExtractionOutputSchema = z.object({
  claims: z.array(AtomicClaimSchema).max(EVIDENCE_EXTRACTION_BATCH_SIZE * MAX_CLAIMS_PER_SOURCE_SEGMENT),
});
export type EvidenceExtractionOutput = z.infer<typeof EvidenceExtractionOutputSchema>;

const NON_RESPONDENT_SPEAKERS = new Set([
  "interviewer",
  "agent",
  "ai",
  "assistant",
  "moderator",
  "system",
]);

function isRespondentSpeaker(speaker: string): boolean {
  return !NON_RESPONDENT_SPEAKERS.has(speaker.trim().toLowerCase());
}

/**
 * Select only respondent speech. Source indices remain indices into the
 * original transcript, so every later evidence reference is auditable against
 * its durable transcript document.
 */
export function buildEvidenceSourceSegments(
  segments: readonly TranscriptSegment[],
): EvidenceSourceSegment[] {
  let latestModeratorContext = "";
  const sources: EvidenceSourceSegment[] = [];

  for (const [segmentIndex, segment] of segments.entries()) {
    const text = segment.text.trim();
    if (!text) continue;
    if (!isRespondentSpeaker(segment.speaker)) {
      latestModeratorContext = text.slice(0, 4_000);
      continue;
    }
    sources.push({
      segmentIndex,
      sourceText: text,
      questionText: latestModeratorContext,
    });
  }
  return sources;
}

/** Reject malformed or source-less LLM claims rather than silently dropping them. */
export function validateClaimsForSources(
  raw: unknown,
  sources: readonly EvidenceSourceSegment[],
): AtomicClaim[] {
  const parsed = EvidenceExtractionOutputSchema.parse(raw);
  const validIndexes = new Set(sources.map((source) => source.segmentIndex));
  const counts = new Map<number, number>();
  const seen = new Set<string>();

  return parsed.claims.map((claim) => {
    if (!validIndexes.has(claim.segmentIndex)) {
      throw new Error(`atomic claim references non-respondent segment ${claim.segmentIndex}`);
    }
    const count = (counts.get(claim.segmentIndex) ?? 0) + 1;
    if (count > MAX_CLAIMS_PER_SOURCE_SEGMENT) {
      throw new Error(`too many atomic claims for segment ${claim.segmentIndex}`);
    }
    counts.set(claim.segmentIndex, count);
    const key = [claim.segmentIndex, claim.claim.trim().toLowerCase(), claim.claimType, claim.stance].join("\\u0000");
    if (seen.has(key)) {
      throw new Error(`duplicate atomic claim for segment ${claim.segmentIndex}`);
    }
    seen.add(key);
    return claim;
  });
}
