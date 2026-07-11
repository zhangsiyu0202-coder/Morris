# Workspaces & Billing — Tasks (build order)

> Status: **Draft** (2026-06-11). Implements `design.md`; governed by ADR 0006.
> Sequenced per `architecture.md` cross-module order: **contracts -> schema ->
> functions -> agent -> web**, one cohesive PR per milestone. Per
> `pre-implementation.md` **no-MVP**: each milestone ships its happy path, error
> codes, concurrency safety, rollback, AND tests in the SAME PR. No deferrals.

Legend: each milestone lists its PR scope, the mandatory tests that gate it, and
its dependency. Pricing-dependent items are blocked on the PRD (`bmad-prd`).

## M0 — PRD for pricing (parallel, non-code)

- Run `bmad-prd` to resolve `requirements.md §8` (Plus/Pro prices, included
  interviews, overage, trial, "completed" definition). M5/M7 depend on it.
- Output: a PRD doc; no code.

## M1 — Contracts (`packages/contracts/src/billing.ts`)

- Add `Workspace`, `WorkspaceMembership`, `WorkspaceRole`, `Plan`, `PlanFeature`,
  `Subscription`, `UsageEvent`, `UsageCounter`, `QuotaState` (+ `superRefine`).
- Add `workspaceId` + recast `ownerUserId`->`authorId` on owner-scoped entities
  (keep `ownerUserId` deprecated-readable during rollout).
- Add error codes to the registry. Mirror `workspaceId` + `UsageEvent` to
  `apps/agent/agent/contracts.py`.
- **Tests (same PR)**: schema round-trip + rejection for every new `superRefine`;
  `pnpm -F @merism/contracts test`; `pnpm test:py` mirror round-trip.
- **Depends on**: nothing. **Unblocks**: everything.

## M2 — Schema + migration (`packages/appwrite-schema`)

- Model Workspace via Appwrite Teams; add collections `plans`, `subscriptions`,
  `usage_events` (unique `sessionId`), `usage_counters`, `workspace_quota`.
- Switch owner-scoped collections to team-read + author-write; admin delete-only.
- Idempotent, reversible migration: personal workspace per existing account,
  backfill `workspaceId`/`authorId`, re-issue permissions, verify counts.
- **Tests (same PR)**: `pnpm schema:verify` clean on local stack; migration
  dry-run diff; permission-matrix property test extended for team-read /
  author-write / tenant isolation.
- **Depends on**: M1.

## M3 — Tenancy Functions (`createWorkspace`, `inviteMember`)

- `createWorkspace`: Team + owner membership + trial subscription stub
  (deterministic id, idempotent).
- `inviteMember`: seat-cap CAS via seat-slot ids; membership view write.
- **Tests (same PR)**: pure-core 100% branch; **seat-cap concurrency property**
  (N concurrent accepts never exceed `plan.seats`); **single-owner role
  invariant**; tenant isolation on every input `workspaceId`.
- **Depends on**: M1, M2.

## M4 — Access model enforcement

- Apply read-shared/write-private + admin-governance permissions on study/report/
  notebook writes from `apps/web` server actions + Functions; ensure non-authors
  get read-only.
- **Tests (same PR)**: **tenant isolation property** (cross-workspace denied);
  author-write / member-read-only; admin-can-delete-not-edit.
- **Depends on**: M2.

## M5 — Billing Functions (`changePlan`, `stripeWebhook`) + Stripe adapter

- `BillingProvider` Stripe adapter behind a narrow interface; Checkout + Portal.
- `stripeWebhook`: signature-verify + idempotent Subscription projection.
- **Tests (same PR)**: **Stripe-webhook idempotency + signature** property
  (replays applied once, bad signature rejected); **secret-leakage** property;
  faked adapter in unit tests, live behind `MERISM_LIVE_TESTS=1`.
- **Depends on**: M1, M2; pricing detail from M0 (price refs).

## M6 — Usage capture + aggregation + quota gate

- Agent finalize emits `UsageEvent` (idempotent `ue_${sessionId}`) on
  `state=completed`.
- `aggregateWorkspaceUsage` (CRON): roll -> `UsageCounter`, report to Stripe,
  recompute `QuotaState`.
- Extend `issueLivekitToken`: resolve `workspaceId`, block when `QuotaState=over`
  with `quota_exceeded`; degrade-never-delete.
- **Tests (same PR)**: **billing idempotency property** (one event per session);
  **quota gate property** (over-quota blocks new token, deletes/mutates nothing);
  aggregation correctness.
- **Depends on**: M1, M2, M5 (usage reporting target); agent finalize path.

## M7 — Web scenes (switcher / members / billing / plan-gating)

- Workspace switcher (sidebar), `/settings/members`, `/settings/billing` (Portal
  embed + usage meter), plan-gating from `Plan.features[]`. Mauve Quiet.
- **Tests (same PR)**: component/logic tests; plan-gating reflects entitlements;
  read-only rendering for non-authored studies.
- **Depends on**: M3, M5, M6; pricing/feature split from M0.

## M8 — Scope-guard reversal + docs

- Re-narrow `.kiro/steering/scope.md` (lifted concepts -> in-scope per ADR 0006)
  and `pnpm scope-guard` blocklist; keep still-forbidden concepts blocked.
- Update root `AGENTS.md` repo map + sub-spec roadmap; flip `product.yaml`
  `status: in-progress` -> `shipped` when done.
- **Tests (same PR)**: `pnpm scope-guard` green with the new narrowed list.
- **Depends on**: lands incrementally alongside M1..M7 (each PR narrows only what
  it introduces), final cleanup here.

## Dependency graph

```
M1 ──> M2 ──> M3 ──> M7
  │      ├──> M4
  │      └──> M6 ──> M7
  └──> M5 ──> M6, M7
M0 (PRD) ──> M5, M7
M8 narrows scope-guard incrementally across M1..M7
```
