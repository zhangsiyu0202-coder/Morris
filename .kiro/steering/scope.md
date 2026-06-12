---
inclusion: always
---

# Scope (binding)

Permanent product-shape exclusions, the borrow-or-build decision flow, and the scope-drift signals to refuse on sight. This file answers "should this exist in Merism at all?" before any code is written. Read together with `pre-implementation.md` (which answers "now that we agreed it exists, how do we start?").

## Permanent exclusions (binding)

The following concepts are out of scope by architecture. They MUST NOT appear as fields, collections, Functions, UI surfaces, dependencies, or docs. If a request appears to require one of them, STOP and open an ADR proposing an architecture change BEFORE any code.

| Excluded concept | Why it is out of scope |
|---|---|
| Teams / organizations / workspaces | Single-researcher product. No tenant boundary above `ownerUserId`. |
| Multi-user collaborative editing | Surveys are owner-edited; concurrent edits are not modeled. |
| Sharing / commenting / mentions | No social surface. Reports are private to the owner. |
| Billing / subscriptions / plans / tiers | No commercial layer. Pricing belongs to a different deployment shape. |
| Quotas / seats / usage metering | No metric is collected for billing purposes. Operational metrics are fine. |
| Role-based access control beyond `owner` and `anonymous interviewee` | Two-role model. No editor/viewer/admin split. |
| Public marketplace of surveys / templates | Surveys are not shared between researchers. |
| Persistent interviewee accounts | Interviewees are accountless; access is via short-lived `InterviewLink`. |
| Email/notification workflows for interviewees | Out of scope until an explicit ADR adds it. |
| Analytics on the researcher (their behaviour) | We analyse interview content, not the researcher's clicks. |

`pnpm scope-guard` enforces a literal-string blocklist for these concepts. Adding a new word to the blocklist requires an ADR; removing one requires an ADR too.

## Borrow-or-build decision flow (binding)

When borrowing a pattern from PostHog, Linear, Notion, Dovetail, or any other product:

1. **Identify the use case the source serves.** Not the artifact name — the actual job the artifact does in their stack. Example: PostHog `Notebook` is "researcher-authored ad-hoc question + AI-written report"; PostHog `Survey` is "in-app feedback widget"; their `UserInterviewTopic` is "AI voice interview campaign".
2. **Map to the closest existing Merism artifact.** Cross-reference the canonical list:
   - Interview question source-of-truth: `Survey` + `SurveySection` + `QuestionBlock`
   - Research backdrop for the LLM: `Survey.flowConfig.{researchGoal, targetAudience, introScript}`
   - Per-section agent guidance: `SurveySection.supervisorInstruction` / `sectionInstruction`
   - Anonymous interviewee access grant: `InterviewLink`
   - Per-session structured analysis: `AnalysisReport` (`scope=session`)
   - Survey-level rollup analysis: `AnalysisReport` (`scope=survey`) and its embedded `insights[]`
   - Researcher ad-hoc question + AI report: `Notebook` (collection)
   - Page-assistant actions on Merism data: Morris `ToolLoopAgent` tools
3. **If a Merism artifact already serves that use case, OPTIMIZE it.** Better schema, better LLM prompt, better UI. Do NOT introduce a parallel concept under a borrowed name.
4. **If no Merism artifact serves it, borrow the SHAPE but rename it for the Merism use case.** Do not import a foreign name that brings foreign assumptions.

What is safe to borrow:
- Shape (data structure, state machine, event names)
- Design tradeoffs (why they don't use X, concurrency model, rollback ordering)
- Test ideas (property invariants, fixtures shape)

What is NEVER borrowed verbatim:
- Code (must be rewritten in Merism naming and style)
- Concepts when a Merism artifact already covers the use case
- Names that bring foreign domain assumptions (`Team`, `Workspace`, `Plan`, `Insight` if it conflicts with `Notebook`/`AnalysisReport.insights[]`)

## Anti-patterns to refuse (binding)

The following requests look reasonable but conflict with the scope rules above. Reject them on sight unless an ADR explicitly overrides:

- A new collection or field that is a parallel "interview question list" outside `Survey + SurveySection + QuestionBlock`.
- A "research knowledge base" / chunked retrieval system holding the same researcher intent that already lives on `Survey.flowConfig`.
- A top-level `agentSystemContext` field parallel to `SurveySection.supervisorInstruction`.
- A "personalization key" on `InterviewLink` other than the existing link concept (or a thin sibling table keyed on `linkId + intervieweeIdentifier`).
- Collapsing `AnalysisReport.insights[]` (auto-generated insight items inside a survey-scope report) with the `Notebook` collection (researcher-authored). Per ADR-0003 D2 they are intentionally separate.
- Morris tools that are conversational chat features rather than actions on Merism data (Morris is a `ToolLoopAgent`, not a chat playground).
- Direct Appwrite collection writes from anonymous (interviewee) clients. The only path is a Function (`issueLivekitToken` is the canonical example).
- A second LLM provider beyond DeepSeek, or a second ASR/TTS provider beyond Qwen, without an ADR.

## Scope-drift signals (binding)

The following words/concepts in a PR description, sub-spec, or chat are STOP signals. Pause and verify the request does not violate the permanent exclusions above:

- `members`, `collaborators`, `permissions`, `roles` (beyond owner/anonymous)
- `pricing`, `plan`, `tier`, `subscription`, `quota`, `seat`, `metering`
- `share with team`, `invite teammate`, `comment on`, `mention`
- `marketplace`, `template gallery`, `public profile`
- `usage report` in any sense other than research-content analysis
- `audit log` for researcher actions (we audit interview content, not researcher clicks)

If any of these surface, the default answer is "out of scope". Pursuing them requires:
1. Open an ADR in `docs/adr/<NNNN>-<slug>.md` proposing the architecture change.
2. Get approval BEFORE any contract change in `packages/contracts`.
3. Update `pnpm scope-guard` blocklist in the same PR if the concept is now permitted.

## Enforcement

```bash
# Scope guard runs in CI; it greps the workspace for forbidden concepts.
pnpm scope-guard
```

A PR that adds a forbidden concept without a matching ADR is rejected at review.
