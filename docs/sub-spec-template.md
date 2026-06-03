# Sub-spec starter template

Use this checklist when starting a new sub-spec (`survey-editor`,
`interviewee-portal`, `ai-interview-engine`, `analysis-report`).

## 1. Declare the prerequisite

Begin the sub-spec's `design.md` with an explicit reference to the architecture
baseline:

```
Prerequisite: foundation-setup/design.md §Components and Interfaces
```

Do not redefine cross-module contracts; consume them from `packages/contracts`
(zod / TS) and `apps/agent/agent/contracts.py` (pydantic). If a contract must
change, update `packages/contracts` first, then the consumers (the root
`typecheck` will surface every break).

## 2. Reuse the contracts

| Need | Source |
|---|---|
| Entity shapes (Survey, Session, …) | `@merism/contracts` entities |
| `issueLivekitToken` request/response | `@merism/contracts` api |
| `analyzeSession` / `AnalysisReport` IO | `@merism/contracts` api |
| LiveKit interview workflow state/results | `@merism/contracts` state/api |
| Appwrite collections / permissions / buckets | `@merism/appwrite-schema` |
| Logger / retry / error boundary | `@merism/observability` |

## 3. Create the property-test directory

```bash
mkdir -p tests/properties/<your-spec>
cp tests/properties/_template.test.ts tests/properties/<your-spec>/<name>.test.ts
# Python: cp apps/agent/tests/properties/_template_test.py apps/agent/tests/properties/<name>_test.py
```

## 4. Reference the correctness properties you implement

Map each PBT to its `design.md §Correctness Properties` entry. The properties
each sub-spec owns:

| Spec | Properties |
|---|---|
| survey-editor | P-DATA-01, P-SEC-04 |
| interviewee-portal | P-DATA-05, P-SEC-03 |
| ai-interview-engine | P-DATA-02/03, P-FLOW-01..05, P-RT-01..04 |
| analysis-report | P-DATA-04, P-ANL-01..03 |

(foundation-setup owns P-SEC-01 and P-SEC-02.)

## 5. Register new correctness properties

If a sub-spec introduces a new invariant, add it to that sub-spec's `design.md`
§Correctness Properties with a new `P-<AREA>-NN` id, and place the executable
test under `tests/properties/<your-spec>/` (TS) or
`apps/agent/tests/properties/` (Python).

## 6. Respect the scope guard

`pnpm scope-guard` (CI) blocks teams / sharing / comments / billing /
subscriptions / quotas / plans / seats / usage-metering. If a request seems to
need one of these, stop and request an explicit architecture-scope update.
