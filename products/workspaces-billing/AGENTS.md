# Workspaces & Billing — Product Charter (AGENTS.md)

> This is a standalone product workstream that turns Merism from a
> single-researcher tool into a **multi-tenant commercial cloud SaaS**.
> Governing decision: **`docs/adr/0006-workspaces-seats-plans-and-usage-billing.md`
> (Status: Accepted, 2026-06-11)**. Read ADR 0006 in full before touching any
> code in this workstream — it is the source of truth; this file is the
> operating charter that turns it into day-to-day rules.

## What this product is

A workspace-scoped, paid, multi-researcher SaaS layer:

- **Workspace** = the tenant boundary (one paying entity), implemented on
  **Appwrite Teams** (`teamId === workspaceId`).
- **Roles**: `owner` (creator/payer, exactly one) / `admin` (governance) /
  `member` (seat-limited researcher).
- **Access**: read-shared within the workspace, **write-private to the author**
  (B can read A's study, never edit it). No co-editing — ever.
- **Plans**: `Plus` / `Pro` (entitlements + feature flags + usage allowance).
- **Billing**: seat subscription + usage, where the billable unit is a
  **completed interview session** (`state=completed`, idempotent per
  `sessionId`), via **Stripe directly** (no billing microservice).
- **Metering/quota**: a scheduled aggregator Function + a `quotaState` gate at
  `issueLivekitToken`. Over-quota **blocks new interviews, never deletes data**.

## Scope — what this workstream MAY and MAY NOT add

ADR 0006 lifts these from `scope.md` permanent exclusions (now in-scope HERE):
workspaces/tenancy, plans/subscriptions (Plus/Pro), seats, usage metering, and a
**three-role** model (`owner/admin/member`).

Still forbidden — do NOT introduce, even in this workstream:

- Collaborative / co-editing of a study (the access model is read-shared,
  write-private — there is no shared-mutation path).
- Per-resource RBAC, custom roles, or a 4th role.
- The PostHog `org -> project -> team` 3-tier hierarchy (Merism is **one** tier).
- An external billing microservice (Stripe direct only).
- Sharing/commenting/mentions across workspaces, a survey marketplace, or
  persistent interviewee accounts. Interviewees stay accountless and OUTSIDE
  every workspace.
- A second LLM/ASR/TTS provider. Stripe is a *payment* provider; it does not
  touch the DeepSeek/Qwen single-provider rules.

If a request seems to need any forbidden item, STOP and open a new ADR — same
gate ADR 0006 itself went through.

## Build order (binding — follow `architecture.md` cross-module order)

Land as cohesive PRs, contracts-first, each with its tests in the SAME PR:

1. **contracts** (`packages/contracts`): `Workspace`, `WorkspaceMembership`
   (role enum), `Plan`, `PlanFeature`, `Subscription`, `UsageEvent`,
   `UsageCounter`, `QuotaState`; add `workspaceId` (tenant key) + recast
   `ownerUserId` as `authorId` on owner-scoped entities; `superRefine` for tenant
   invariants; error codes `seat_limit_reached`, `quota_exceeded`. Mirror only
   `workspaceId` on `InterviewSession` + the `UsageEvent` emit shape into
   `apps/agent/agent/contracts.py`.
2. **appwrite-schema** (`packages/appwrite-schema`): workspaces via Appwrite
   Teams; new collections (`plans`, `subscriptions`, `usage_events`,
   `usage_counters`, `workspace_quota`); team-read + author-write permission
   model; idempotent, reversible **migration** wrapping each existing account's
   data into a personal default workspace.
3. **functions** (`apps/functions/*`): `createWorkspace`, `inviteMember`
   (seat-cap check), `changePlan`, `stripeWebhook`, `aggregateWorkspaceUsage`
   (scheduled); extend `issueLivekitToken` with the workspace + `quotaState`
   gate; emit the billable `UsageEvent` on session completion. Pure-core +
   SDK-wrapper shape; secrets only in `main.ts`.
4. **agent** (`apps/agent`): emit the billable usage signal on `state=completed`
   through the existing one-way finalize path; per-workspace isolation of
   persisted artifacts. No per-turn metering.
5. **web** (`apps/web`): workspace switcher, members/seats admin, billing page
   (Stripe Customer Portal), plan-gating driven by `Plan.features[]`. Mauve Quiet
   design system.
6. **steering reversal** (in the SAME PR as the concept it unblocks): re-narrow
   `scope.md` and `pnpm scope-guard` — move lifted concepts to "in-scope per
   ADR 0006", keep the still-forbidden ones blocked.

## Mandatory tests (per `testing.md`, same PR as code)

Property-based, in `tests/properties/` unless noted:

- **Tenant isolation**: a user in workspace X can never read/write any row with
  `workspaceId != X`. (New top-tier invariant.)
- **Seat cap**: N concurrent invites never exceed `plan.seats`.
- **Billing idempotency**: a session is billed at most once across
  retries/concurrency (one `UsageEvent` per `sessionId`).
- **Quota gate**: over-quota blocks new `issueLivekitToken` and mutates/deletes
  nothing.
- **Stripe webhook**: signature-verified; replayed events are idempotent.

## Borrow-from-PostHog discipline

ADR 0006 has the reference table (`/home/jia/posthog` files + how Merism
differs). Borrow **shape and trade-offs, never code**; rename every concept to
the Merism domain. We ship ~1/3 of PostHog: one tenant tier, three coarse roles,
Stripe-direct, scheduled-Function metering, cloud-only.

## Secrets

Stripe keys (`STRIPE_SECRET_KEY`, webhook signing secret) follow
`errors-and-observability.md`: server-only in `main.ts`, `maskSecret` in any log,
never in `handler.ts` pure cores, never in responses/snapshots. Register each new
flag in the `.kiro/steering/errors-and-observability.md` flag table + `.env.example`.

## Required next skill

The implementation sub-spec (requirements / design / tasks) for this workstream
MUST be authored via the **`bmad-spec`** skill (mandatory per root `AGENTS.md`).
ADR 0006 (architecture) is done; the sub-spec is the next artifact, then
`bmad-prd` to lock the PRD-pending pricing (seat/interview prices, Plus vs Pro
feature split, overage behavior, trial, "completed-interview" definition).

## Pointers

- `docs/adr/0006-workspaces-seats-plans-and-usage-billing.md` — governing decision.
- `.kiro/steering/{scope,architecture,contracts,errors-and-observability,testing,pre-implementation}.md` — binding rules.
- ADR 0005 — the scheduled-Function pattern reused for usage aggregation.
- PostHog (`/home/jia/posthog`) — reference shapes cited in ADR 0006.
