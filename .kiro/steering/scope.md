---
inclusion: always
---

# Scope (binding)

Permanent product-shape exclusions, the borrow-or-build decision flow, and the scope-drift signals to refuse on sight. This file answers "should this exist in Merism at all?" before any code is written. Read together with `pre-implementation.md` (which answers "now that we agreed it exists, how do we start?").

## Permanent exclusions (binding)

The following concepts remain out of scope. They MUST NOT appear as fields, collections, Functions, UI surfaces, dependencies, or docs. If a request appears to require one of them, STOP and open an ADR proposing an architecture change BEFORE any code.

| Excluded concept | Why it is out of scope |
|---|---|
| Multi-user collaborative editing | Studies are single-author; per ADR-0006 D3 access is read-shared/write-private (B reads A's study, never edits). Concurrent edits on one document are not modeled. |
| Sharing / commenting / mentions across workspaces | No cross-workspace social surface. (Within-workspace read access is workspace-scoped, not "share".) |
| Per-resource RBAC, custom roles, the org → project → team 3-tier hierarchy | The role model is the three coarse roles in the lifted set below, no finer. PostHog-style per-resource ACL is rejected (ADR-0006 § Alternatives rejected). |
| Public marketplace / template gallery of surveys | Surveys are not shared between workspaces. |
| Persistent interviewee accounts | Interviewees are accountless; access is via short-lived `InterviewLink`. |
| Email / notification workflows for interviewees | Out of scope until an explicit ADR adds it. |
| Analytics on the researcher's behaviour | We analyse interview content, not researcher clicks. |
| Self-host + license keys | Cloud-only deployment (ADR-0006 § Alternatives rejected). |

`pnpm scope-guard` enforces a literal-string blocklist for these concepts. Adding a new word to the blocklist requires an ADR; removing one requires an ADR too.

## In-scope, governed by ADR-0006 (binding)

The following concepts were originally in the permanent-exclusion list but were **lifted by ADR-0006 (Accepted 2026-06-11)** so Merism could become a multi-tenant commercial cloud SaaS. They are in-scope **only inside the surfaces listed below**; outside those surfaces they remain forbidden so no other module grows a parallel tenancy/billing concept.

| Lifted concept | Allowed surface (mirrored in `scripts/scope-guard.ts::EXEMPT_PREFIXES`) |
|---|---|
| Workspaces / Teams (single-tier tenant boundary above `ownerUserId`, backed by Appwrite Teams) | `apps/functions/{createWorkspace,inviteMember,changePlan,stripeWebhook,aggregateWorkspaceUsage,issueLivekitToken,analyzeSession,analyzeSurvey}/`, `apps/agent/agent/persistence/appwrite_repository.py`, `apps/agent/agent/contracts.py` (mirror), `apps/web/{app/settings/{billing,members},components/workspace-billing,lib/{workspace-billing,auth/workspace.ts,actions/{bookmarks,survey},queries/{bookmarks,client,sessions,notebooks,studies},mock/workspace-billing.ts}}`, `packages/{contracts/src/billing.ts,appwrite-schema/src/schema.ts}`, `products/workspaces-billing/`, `scripts/{seed-workspace,seed-plans,migrate-default-workspaces,backfill-workspace-tenancy}.ts` |
| Three coarse roles (`owner` / `admin` / `member`) | Same surfaces as Workspaces. Per-resource RBAC remains forbidden. |
| Plans / tiers (`Plus`, `Pro`) — entitlements + feature flags + usage allowance | `packages/contracts/src/billing.ts`, `apps/functions/changePlan/`, `apps/web/app/settings/billing/`, `products/workspaces-billing/spec/prd-pricing.md` |
| Subscriptions, seats (member-count entitlement) | Same as Plans. Add-on seats beyond the plan band remain PRD-pending. |
| Usage metering (billable unit = a completed interview session) + quotas | `apps/functions/aggregateWorkspaceUsage/`, `apps/functions/issueLivekitToken/` (entry-gate), `apps/agent/agent/persistence/appwrite_repository.py` (UsageEvent emit on `state=completed`) |
| Stripe billing integration (Checkout / Customer Portal / Webhooks) | `apps/functions/stripeWebhook/`, `apps/web/app/settings/billing/` |

The lift is **narrow** — it does not unlock co-editing, cross-workspace sharing, per-resource RBAC, marketplace, persistent interviewee accounts, or self-host. Those stay in the permanent-exclusion table above.

Adding a new path to `EXEMPT_PREFIXES` requires either an ADR amendment or a same-PR rationale tied to ADR-0006. Removing a path is a chore-level change.

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
- A second LLM provider beyond the primary cascade LLM (Qwen-VL, per ADR-0011; DeepSeek is a dormant secondary), or a second ASR/TTS provider beyond Qwen, without an ADR.

## Scope-drift signals (binding)

The following words/concepts in a PR description, sub-spec, or chat are STOP signals. Pause and verify the request does not violate the permanent exclusions above (some of these are allowed only inside the ADR-0006 lifted surfaces — outside those, they are still scope drift):

- `collaborators`, `co-edit`, `concurrent edit on the same study` — still permanently forbidden (D3 read-shared/write-private)
- `share with team`, `comment on`, `mention` — cross-workspace sharing remains forbidden
- `marketplace`, `template gallery`, `public profile` — public sharing is forbidden
- `per-resource permission`, `custom role`, `editor / viewer split` — three coarse roles only
- `persistent interviewee account`, `interviewee login` — interviewees stay anonymous
- `audit log` for researcher actions (we audit interview content, not researcher clicks)
- `usage report` in any sense other than research-content analysis OR ADR-0006 billing usage
- `members`, `pricing`, `plan`, `tier`, `subscription`, `quota`, `seat`, `metering`, `invite teammate`, `roles` — **allowed only inside `EXEMPT_PREFIXES`** in `scripts/scope-guard.ts`. Outside those paths these words are scope drift.

If any of these surface, the default answer is "out of scope". Pursuing them requires:
1. Open an ADR in `docs/adr/<NNNN>-<slug>.md` proposing the architecture change.
2. Get approval BEFORE any contract change in `packages/contracts`.
3. Update `pnpm scope-guard` blocklist (and `EXEMPT_PREFIXES` if narrowing scope) in the same PR if the concept is now permitted.

## Enforcement

```bash
# Scope guard runs in CI; it greps the workspace for forbidden concepts.
pnpm scope-guard
```

A PR that adds a forbidden concept without a matching ADR is rejected at review.
