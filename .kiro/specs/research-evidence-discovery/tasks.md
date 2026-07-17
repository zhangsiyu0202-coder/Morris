# Tasks — research-evidence-discovery

- [x] Add the Jina embedding provider adapter with validated 1024-dimensional
  query/passage modes, retry classification, and unit tests.
- [x] Add `ResearchEvidence` contract and Appwrite collection with deterministic
  source identity and property tests.
- [ ] Add `analyzeEvidence` Function to segment finalized transcripts, extract
  atomic claims, and index idempotently.
- [ ] Add deterministic vector recall, bounded Cohere rerank, and finding
  support/counter-evidence checks to the survey analysis path.
- [ ] Add optional, evidence-backed novelty/value fields to the survey report
  contract and render them only after an end-to-end local-stack verification.
- [ ] Run contract/schema/function/property suites and a local provider probe;
  deploy runtime variables only after the probe succeeds.
