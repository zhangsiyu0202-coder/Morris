# Design — research-evidence-discovery

## Data flow

```text
finalized Transcript
  -> semantic segment + atomic claim extraction
  -> ResearchEvidence (source ref + metadata + Jina vector)
  -> vector recall / clustering / contrast candidates
  -> Cohere rerank of a bounded candidate set
  -> DeepSeek interpretation and counter-evidence check
  -> optional additive findings on AnalysisReport(scope=survey)
```

`AnalysisReport` remains the only auto-generated report artifact. `Notebook`
remains the researcher-authored ad-hoc report artifact. The intermediate
evidence index is an internal analysis input, not a second report surface.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `packages/contracts` | Persistent evidence and additive report schemas only. |
| `packages/appwrite-schema` | Evidence collection, owner permissions, and source lookup indexes. |
| `apps/functions/analyzeEvidence` | Pure handler plus provider/Appwrite deps; indexes one finalized session idempotently. |
| `apps/functions/analyzeSurvey` | Consumes validated candidates; reranks only after recall. |
| `apps/functions/*/src/providers` | Narrow Jina/Cohere adapters; parse third-party responses. |

## Provider contracts

Jina uses the OpenAI-compatible embeddings request shape routed through
`AIHUBMIX_BASE_URL` when set. The adapter defaults only to the configured
AIHubMix URL; the deployment configuration must use `https://api.inferera.com`
when the primary route is unavailable. It sends model
`jina-embeddings-v5-text-small`, `dimensions: 1024`, and one of the two task
modes required by REQ-2.

Cohere reranking stays in the existing `analyzeSurvey` adapter. It is called
only after vector recall has bounded the set. `top_n` equals the candidate count
so incomplete responses are rejected before report persistence.

## Error semantics

- Missing configuration, malformed provider payload, or 4xx excluding 408/429
  are permanent provider errors.
- Network failures, 408, 429, and 5xx are transient provider errors and use
  `withRetry`.
- A discovery run never writes a partial `AnalysisReport`; evidence indexing
  may be independently retried because its document id is deterministic from
  `transcriptId + segmentIndex + claim hash`.

## Deferred interface

The initial vertical slice proves the Jina adapter and its contract. The
`ResearchEvidence` persisted entity and `analyzeEvidence` Function follow in
the next slice; no incomplete output is exposed to the report UI.

## References

- Jina embedding API: task-specific retrieval modes and 1024-dimension
  `jina-embeddings-v5-text-small` output.
- Cohere Rerank v2: query plus documents produces ordered indexes and scores.
- PostHog session-summary patterns, already adopted by `analysis-report-v2`,
  for evidence validation and chunked rollup shape only.
