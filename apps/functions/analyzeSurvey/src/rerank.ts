import type { SurveyAnalysisReportOutput } from "@merism/contracts";

export interface ThemeContextForRerank {
  id: string;
  label: string;
  description: string;
  evidenceRefs: Array<{ transcriptId: string; segmentIndex: number }>;
}

type Finding = NonNullable<SurveyAnalysisReportOutput["rankedFindings"]>[number];
type FindingIdentity = Pick<Finding, "kind" | "sourceId">;

export interface RerankCandidateRecord {
  finding: FindingIdentity;
  document: string;
}

export interface RerankProviderResult {
  index: number;
  relevanceScore: number;
}

export interface RerankFindingsInput {
  query: string;
  candidates: readonly RerankCandidateRecord[];
}

export type RerankFindings = (
  input: RerankFindingsInput,
) => Promise<NonNullable<SurveyAnalysisReportOutput["rankedFindings"]>>;

export function buildFindingRerankQuery(input: {
  surveyTitle: string;
  researchIntent: string;
}): string {
  const intent = input.researchIntent.trim();
  return [
    `Research study: ${input.surveyTitle}`,
    ...(intent ? [`Research objective: ${intent}`] : []),
    "Rank these qualitative research findings for decision-making priority.",
    "Prefer relevance to the research objective, breadth of participant coverage, and evidence quality.",
    "Do not infer claims beyond the provided finding documents.",
  ].join("\n");
}

interface BuildRerankCandidatesInput {
  themes: SurveyAnalysisReportOutput["themes"];
  themeContexts: ThemeContextForRerank[];
  insights: SurveyAnalysisReportOutput["insights"];
}

/**
 * Produces a small, evidence-backed candidate set for the external reranker.
 * This is deliberately not a second statistics system: coverage values remain
 * the deterministic values calculated by the rollup.
 */
export function buildRerankCandidates(input: BuildRerankCandidatesInput): RerankCandidateRecord[] {
  const contextsById = new Map(input.themeContexts.map((context) => [context.id, context]));
  const evidenceBackedThemeIds = new Set(
    input.themeContexts
      .filter((context) => context.evidenceRefs.length > 0)
      .map((context) => context.id),
  );

  const themes = [...input.themes]
    .filter((theme) => evidenceBackedThemeIds.has(theme.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((theme) => {
      const context = contextsById.get(theme.id)!;
      return {
        finding: { kind: "theme" as const, sourceId: theme.id },
        document: [
          "kind: theme",
          `sourceId: ${theme.id}`,
          `label: ${theme.label}`,
          `description: ${context.description}`,
          `mentions: ${theme.mentions}`,
          `coveragePct: ${theme.pct}`,
          `sentiment: ${theme.sentiment}`,
          `evidenceCount: ${context.evidenceRefs.length}`,
        ].join("\n"),
      };
    });

  const insights = [...input.insights]
    .filter((insight) => insight.supportingThemeIds.some((themeId) => evidenceBackedThemeIds.has(themeId)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((insight) => ({
      finding: { kind: "insight" as const, sourceId: insight.id },
      document: [
        "kind: insight",
        `sourceId: ${insight.id}`,
        `title: ${insight.title}`,
        `finding: ${insight.text}`,
        `confidence: ${insight.confidence}`,
        `supportingThemeIds: ${insight.supportingThemeIds.join(", ")}`,
      ].join("\n"),
    }));

  return [...themes, ...insights];
}

/**
 * Reranking is only allowed after dense recall. Keep a theme eligible only
 * when at least one existing report ref appears in the recalled evidence set;
 * linked insights follow those surviving themes.
 */
export function buildRecallBoundedRerankCandidates(input: BuildRerankCandidatesInput & {
  recalledRefs: ReadonlySet<string>;
}): RerankCandidateRecord[] {
  return buildRerankCandidates({
    ...input,
    themeContexts: input.themeContexts.map((context) => ({
      ...context,
      evidenceRefs: context.evidenceRefs.filter((ref) =>
        input.recalledRefs.has(`${ref.transcriptId}:${ref.segmentIndex}`),
      ),
    })),
  });
}

/** Converts provider results into a complete, stable persisted ranking. */
export function validateRerankResults(
  candidates: readonly RerankCandidateRecord[],
  results: readonly RerankProviderResult[],
): NonNullable<SurveyAnalysisReportOutput["rankedFindings"]> {
  if (results.length !== candidates.length) {
    throw new Error("rerank results must be complete");
  }

  const seenIndexes = new Set<number>();
  const ordered = results.map((result) => {
    if (!Number.isInteger(result.index) || result.index < 0 || result.index >= candidates.length) {
      throw new Error("rerank result index is out of range");
    }
    if (seenIndexes.has(result.index)) {
      throw new Error("rerank result index is duplicated");
    }
    seenIndexes.add(result.index);
    if (!Number.isFinite(result.relevanceScore) || result.relevanceScore < 0 || result.relevanceScore > 1) {
      throw new Error("rerank result score is invalid");
    }
    return { candidate: candidates[result.index]!, relevanceScore: result.relevanceScore };
  });

  return ordered
    .sort((left, right) =>
      right.relevanceScore - left.relevanceScore ||
      left.candidate.finding.kind.localeCompare(right.candidate.finding.kind) ||
      left.candidate.finding.sourceId.localeCompare(right.candidate.finding.sourceId),
    )
    .map(({ candidate, relevanceScore }, index) => ({
      ...candidate.finding,
      rank: index + 1,
      relevanceScore,
    }));
}
