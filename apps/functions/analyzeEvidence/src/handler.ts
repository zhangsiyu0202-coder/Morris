// Pure analyzeEvidence core. No Appwrite or provider SDK imports.
//
// It indexes one already-completed session. All extraction and embedding finish
// before the persistence boundary; deterministic document identities make a
// failed or concurrent run safely retryable without creating duplicate claims.

import {
  AnalyzeEvidenceRequestSchema,
  type AnalyzeEvidenceResponse,
  type ResearchEvidence,
} from "@merism/contracts";
import {
  buildEvidenceSourceSegments,
  validateClaimsForSources,
  type EvidenceExtractionOutput,
  type EvidenceSourceSegment,
  type TranscriptSegment,
} from "./evidence.js";
import { JINA_EMBEDDING_MODEL, type JinaEmbeddingTask } from "./providers/jina.js";

export interface EvidenceSessionContext {
  sessionId: string;
  surveyId: string;
  ownerUserId: string;
  workspaceId?: string;
  state: "created" | "in_progress" | "completed" | "abandoned" | "failed";
  surveyTitle: string;
  researchIntent: string;
}

export interface EvidenceTranscriptRecord {
  $id: string;
  sessionId: string;
  segments: TranscriptSegment[];
}

export interface EvidenceIdentity {
  $id: string;
  contentHash: string;
}

export interface AnalyzeEvidenceDeps {
  findSessionContext(sessionId: string): Promise<EvidenceSessionContext | null>;
  findTranscript(sessionId: string): Promise<EvidenceTranscriptRecord | null>;
  extractAtomicClaims(input: {
    surveyTitle: string;
    researchIntent: string;
    sources: EvidenceSourceSegment[];
  }): Promise<EvidenceExtractionOutput>;
  embedEvidence(input: { text: string; task: JinaEmbeddingTask }): Promise<number[]>;
  evidenceIdentity(input: {
    transcriptId: string;
    segmentIndex: number;
    sourceText: string;
    claim: string;
    claimType: string;
    stance: string;
  }): EvidenceIdentity;
  upsertEvidence(records: ResearchEvidence[]): Promise<void>;
  now(): number;
}

export type AnalyzeEvidenceResult =
  | { status: 200; body: AnalyzeEvidenceResponse }
  | { status: 400 | 404 | 409 | 500; body: { error: string; traceId?: string } };

function buildEmbeddingText(input: {
  questionText: string;
  sourceText: string;
  claim: string;
}): string {
  return [
    ...(input.questionText ? [`Question context: ${input.questionText}`] : []),
    `Respondent evidence: ${input.sourceText}`,
    `Atomic claim: ${input.claim}`,
  ].join("\n");
}

export async function analyzeEvidence(
  rawInput: unknown,
  deps: AnalyzeEvidenceDeps,
): Promise<AnalyzeEvidenceResult> {
  const parsed = AnalyzeEvidenceRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  const { sessionId } = parsed.data;

  const context = await deps.findSessionContext(sessionId);
  if (!context) return { status: 404, body: { error: "session_not_found" } };
  if (context.state !== "completed") {
    return { status: 409, body: { error: "session_not_completed" } };
  }
  const transcript = await deps.findTranscript(sessionId);
  if (!transcript) return { status: 404, body: { error: "transcript_not_found" } };

  const sources = buildEvidenceSourceSegments(transcript.segments);
  const claims = [];
  try {
    for (let start = 0; start < sources.length; start += 20) {
      const batch = sources.slice(start, start + 20);
      const extracted = await deps.extractAtomicClaims({
        surveyTitle: context.surveyTitle,
        researchIntent: context.researchIntent,
        sources: batch,
      });
      claims.push(...validateClaimsForSources(extracted, batch));
    }
  } catch {
    return { status: 500, body: { error: "claim_extraction_failed" } };
  }

  const sourceByIndex = new Map(sources.map((source) => [source.segmentIndex, source]));
  const createdAt = new Date(deps.now()).toISOString();
  const records: ResearchEvidence[] = [];
  try {
    for (const claim of claims) {
      const source = sourceByIndex.get(claim.segmentIndex);
      if (!source) throw new Error("claim source disappeared");
      const identity = deps.evidenceIdentity({
        transcriptId: transcript.$id,
        segmentIndex: source.segmentIndex,
        sourceText: source.sourceText,
        claim: claim.claim,
        claimType: claim.claimType,
        stance: claim.stance,
      });
      const embedding = await deps.embedEvidence({
        text: buildEmbeddingText({
          questionText: source.questionText,
          sourceText: source.sourceText,
          claim: claim.claim,
        }),
        task: "retrieval.passage",
      });
      records.push({
        $id: identity.$id,
        ownerUserId: context.ownerUserId,
        workspaceId: context.workspaceId,
        surveyId: context.surveyId,
        sessionId,
        transcriptId: transcript.$id,
        segmentIndex: source.segmentIndex,
        questionId: undefined,
        questionText: source.questionText,
        sourceText: source.sourceText,
        claim: claim.claim,
        claimType: claim.claimType,
        stance: claim.stance,
        participantRole: "",
        participantIndustry: "",
        participantCompanySize: "",
        purchaseStatus: "",
        embedding,
        embeddingModel: JINA_EMBEDDING_MODEL,
        contentHash: identity.contentHash,
        createdAt,
      });
    }
  } catch {
    return { status: 500, body: { error: "embedding_failed" } };
  }

  try {
    await deps.upsertEvidence(records);
  } catch {
    // Appwrite has no cross-document transaction. Idempotent document IDs let
    // the next run converge a partial internal index; no report is written here.
    return { status: 500, body: { error: "persist_failed" } };
  }
  return { status: 200, body: { sessionId, indexedCount: records.length } };
}
