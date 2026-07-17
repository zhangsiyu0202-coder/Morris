# Requirements — research-evidence-discovery

## Goal

Turn finalized interview transcripts into an evidence-grounded discovery layer
for the existing `AnalysisReport(scope="survey")`. The system must find repeated
themes, minority signals, group differences, contradictions, and decision-useful
findings without treating a reranker as the analysis model.

## Scope

- Segment finalized transcripts with question context and participant metadata.
- Extract atomic claims, then embed evidence records with
  `jina-embeddings-v5-text-small` through the existing AIHubMix credential.
- Use vector recall before `cohere-rerank-v4.0-fast`; reranking only orders
  already eligible evidence.
- Generate and validate findings against both supporting evidence and
  counter-evidence before adding them to the existing survey `AnalysisReport`.
- Score persisted findings for evidence strength, novelty, business value, and
  actionability. Historic reports remain readable.

## Non-goals

- Do not add a second report, knowledge-base, vector-database, or realtime
  interview controller.
- Do not replace Notebook's Qwen embedding implementation.
- Do not use the reranker to invent topics, write conclusions, or calculate
  statistics.
- Do not change the LiveKit Agent, Morris tools, or report UI until the
  additive report contract is complete and verified.

## Requirements

### REQ-1: evidence record

Each indexed record SHALL retain `surveyId`, `sessionId`, `transcriptId`,
`segmentIndex`, question context, source text, and typed participant metadata.
The source reference must identify a real transcript segment; an evidence record
must never be accepted without that reference.

### REQ-2: embedding boundary

The Jina adapter SHALL request exactly 1024 dimensions and select the correct
task mode: `retrieval.passage` for indexed evidence and `retrieval.query` for
research questions. Provider responses are untrusted and must be schema parsed
before use. The API key is read only from `AIHUBMIX_API_KEY` at runtime.

### REQ-3: discovery order

The pipeline SHALL be: evidence extraction -> embedding/recall -> optional
clustering and contrast detection -> Cohere rerank -> LLM interpretation ->
evidence and counter-evidence validation. Any provider failure must reject the
run without storing partial findings.

### REQ-4: rerank boundary

`cohere-rerank-v4.0-fast` SHALL only receive a bounded candidate set returned
by recall. A provider result must be a complete, non-duplicated mapping to its
input candidates before it can affect report ordering.

### REQ-5: finding validity

Every persisted finding SHALL contain at least one supporting `SegmentRef`; it
shall identify its source population and must not claim causation from
correlation. A finding with no independent evidence or failed counter-evidence
check is rejected rather than downgraded silently.

### REQ-6: novelty and value

Novelty is not raw rarity. The score SHALL combine distance from prior findings,
independent-source count, segment/group distribution, and contradiction signals.
Business value and actionability are separate bounded scores.

### REQ-7: compatibility and verification

All additions to `SurveyAnalysisReportOutput` SHALL be optional. The first
implementation ships with unit and property tests for source-reference
integrity, ranking completeness, score bounds, and deterministic recall.
Provider connectivity tests are local-only and never run in CI.
