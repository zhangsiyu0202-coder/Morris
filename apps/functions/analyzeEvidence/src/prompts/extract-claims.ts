import type { EvidenceSourceSegment } from "../evidence.js";

export const EXTRACT_ATOMIC_CLAIMS_SYSTEM = `You are a qualitative research evidence extractor. Extract only atomic claims directly supported by respondent speech. Do not infer causes, business recommendations, or facts absent from the transcript.

Return strict JSON: { "claims": [{ "segmentIndex": number, "claim": string, "claimType": "pain_point"|"need"|"motivation"|"barrier"|"behavior"|"contradiction"|"other", "stance": "positive"|"negative"|"conditional"|"neutral" }] }.

Rules:
- Every claim must cite exactly one supplied respondent segmentIndex.
- Use zero to three claims per respondent segment.
- Rephrase faithfully and concisely; keep the original condition or qualifier.
- Never use moderator-only text as evidence.
- If no supported claim exists, return { "claims": [] }.
- Do not return markdown or fields outside the schema.`;

export function buildExtractAtomicClaimsPrompt(input: {
  surveyTitle: string;
  researchIntent: string;
  sources: readonly EvidenceSourceSegment[];
}): string {
  return [
    `Research study: ${input.surveyTitle}`,
    ...(input.researchIntent.trim() ? [`Research objective: ${input.researchIntent.trim()}`] : []),
    "",
    "Respondent source segments:",
    ...input.sources.map((source) => [
      `segmentIndex: ${source.segmentIndex}`,
      ...(source.questionText ? [`preceding moderator context: ${source.questionText}`] : []),
      `respondent text: ${source.sourceText}`,
    ].join("\\n")),
    "",
    "Return the strict JSON object now.",
  ].join("\\n");
}
