# Workspaces & Billing — Design

> Status: **Draft** (2026-06-11). Implements `requirements.md`; governed by ADR 0006.
> Reference: PostHog `ee/billing/{billing_types,quota_limiting}.py`, `posthog/models/organization.py`, `products/user_interviews/backend/facade` (`/home/jia/posthog`). Borrow shape; rewrite in Merism naming.
> Data-flow order follows `architecture.md`: contracts -> schema -> functions -> agent -> web.

## 0. Data-flow sketch

```
researcher (web)                         interviewee (anonymous)
   |  createWorkspace / inviteMember         |  join link
   |  changePlan (Stripe Checkout/Portal)    v
   v                                      issueLivekitToken --[quota gate]--> session
Appwrite Teams (= Workspace) <----+          |
   |  team-read / author-write     |          v  state=completed
   v                               |       agent emits UsageEvent (idempotent /sessionId)
studies/reports (workspaceId,authorId)        |
                                              v
   stripeWebhook  <--Stripe-->  Subscription  aggregateWorkspaceUsage (CRON)
                                   |              | rolls UsageEvent -> UsageCounter
                                   v              v  reports usage to Stripe
                                 QuotaState <-----+  derived; read by issueLivekitToken
```

## 1. Data model (`packages/contracts/src/billing.ts` — new file)

New zod schemas + inferred types. camelCase, `$id` passthrough, ISO datetimes,
`superRefine` for cross-field invariants (per `contracts.md`). Borrowed in shape
from PostHog `billing_types.py` (`Product/ProductPlan/Tier`) and
`organization.py` membership levels, renamed for Merism.

```ts
// Tenancy
WorkspaceSchema           // $id, name, ownerUserId (the owner), planKey, createdAt
WorkspaceRole = z.enum(["owner","admin","member"])
WorkspaceMembershipSchema // $id, workspaceId, userId, role, status(active|invited), invitedBy, createdAt
                          // mirrors Appwrite Team membership; persisted view for queries/tests

// Plans & subscription
PlanKey = z.enum(["plus","pro"])
PlanFeature = z.enum(["visual_analysis","survey_rollup", /* ... PRD-pending */])
PlanSchema                // key, seats, features[], includedInterviews, priceRef (Stripe price id ref)
SubscriptionStatus = z.enum(["trialing","active","past_due","canceled"])
SubscriptionSchema        // $id, workspaceId, planKey, status, stripeCustomerId, stripeSubscriptionId,
                          //   currentPeriodStart, currentPeriodEnd, seats

// Usage & quota
UsageEventSchema          // $id, workspaceId, studyId, sessionId (unique), occurredAt, unit="completed_interview"
UsageCounterSchema        // $id, workspaceId, periodStart, periodEnd, completedInterviews:int>=0
QuotaStateSchema          // workspaceId, periodEnd, usedInterviews, includedInterviews, hardCeiling, state(ok|over)
```

Cross-field invariants (`superRefine`):

- `SubscriptionSchema`: `seats >= 1`; `currentPeriodEnd > currentPeriodStart`.
- `UsageEventSchema`: `unit == "completed_interview"` (single billable unit today).
- Owner-scoped entities (`Survey`, `Project`, `InterviewLink`, `InterviewSession`,
  `Recording`, `AnalysisReport`, `Notebook`, `Dashboard*`) gain
  `workspaceId: string` (tenant key) and **recast `ownerUserId` -> `authorId`**
  (the creator). A migration shim keeps reading the old field during rollout
  (deprecation pattern, `contracts.md`).

**Python mirror** (`apps/agent/agent/contracts.py`): only `workspaceId` on
`InterviewSession` and the `UsageEvent` emit shape (identical camelCase). Nothing
else — the agent does not need plans/subscriptions.

New error codes (registry in `errors-and-observability.md`): `seat_limit_reached`
(409), `quota_exceeded` (402/403 TBD), `workspace_not_found` (404),
`not_workspace_member` (403), `stripe_signature_invalid` (400).

## 2. Tenancy & permissions = Appwrite Teams

- **Workspace == Appwrite Team** (`teamId === workspaceId`). Membership, invites,
  and roles are Appwrite Team features — no hand-rolled membership table is the
  source of truth; `WorkspaceMembership` rows are a **denormalized read view**
  kept in sync for querying/testing (Appwrite Team membership remains canonical).
- **Document permissions** encode FR-A declaratively:
  - read: `Permission.read(Role.team(workspaceId))`
  - write/delete by author: `Permission.update(Role.user(authorId))`,
    `Permission.delete(Role.user(authorId))`
  - admin governance (archive/delete any): granted to
    `Permission.delete(Role.team(workspaceId, "admin"))` for the **delete/archive
    capability only** — NOT `update` (so admins can govern lifecycle but never
    edit a body). Body edits stay author-only.
- **Anonymous interviewees**: unchanged. No team membership; `issueLivekitToken`
  remains the only path. The quota gate (§4) is added there but the anonymous
  permission posture is identical to today.

Tenant isolation (FR-A4) is enforced by the Appwrite permission engine
(team-scoped read) **and** re-checked at every Function boundary that takes a
`workspaceId` (defense in depth; property-tested in §6 of requirements).

## 3. Functions (the "backend") — pure-core + SDK-wrapper per `architecture.md`

Each is a new Appwrite Function (or an extension) following
`apps/functions/issueLivekitToken` shape: `handler.ts` (pure core + typed `Deps`),
`main.ts` (SDK wrapper, secrets), `deps.ts` (`createRealDeps`). Concurrency via
deterministic ids + Appwrite 409-CAS; rollback best-effort.

| Function | Trigger | Core responsibility | Key error codes |
|---|---|---|---|
| `createWorkspace` | web (researcher) | Create Appwrite Team + owner membership + trial `Subscription` stub; deterministic id for idempotency | — |
| `inviteMember` | web (owner/admin) | Check `activeMembers < plan.seats` (CAS), create Team invite, write membership view | `seat_limit_reached`, `not_workspace_member` |
| `changePlan` | web (owner) | Start Stripe Checkout / Portal session for plan change; no local plan write (webhook is source of truth) | `not_workspace_member` |
| `stripeWebhook` | Stripe | Verify signature; idempotently sync `Subscription` (status/seats/period) into Appwrite | `stripe_signature_invalid` |
| `aggregateWorkspaceUsage` | CRON (scheduled) | Roll `UsageEvent` -> `UsageCounter` per workspace/period; report usage to Stripe; recompute `QuotaState` | — |
| `issueLivekitToken` (extend) | interviewee | **Add**: resolve link -> `workspaceId`; check `QuotaState != over` before issuing; reject over-quota | `quota_exceeded` (+ existing link codes) |

Usage capture (FR-U1) is **not** a standalone Function: the agent's existing
one-way session-finalize path writes the `UsageEvent` (idempotent on `sessionId`)
when `state=completed`, alongside the transcript/recording finalize. This keeps
metering on the already-sanctioned realtime->persistence boundary
(`architecture.md`) rather than adding a new per-turn effect.

### Seat-cap concurrency (FR-M2)

Deterministic membership id `m_${workspaceId}_${userId}` + a seat-slot guard:
accepted invites claim a slot id `seat_${workspaceId}_${k}` for `k in
[0, plan.seats)`; the Appwrite unique-id 409 is the gate. No read-modify-write
counter. Exhaustion -> `seat_limit_reached`.

### Billing idempotency (FR-U1 / FR-B3)

`UsageEvent.$id = ue_${sessionId}` -> a session bills at most once regardless of
retries (409 on duplicate is success). `stripeWebhook` dedups on Stripe event id
(`evt_...`) stored on apply.

## 4. Stripe + metering design

- **Provider boundary**: a narrow `BillingProvider` adapter (`stripe.ts`) behind
  an interface, mirroring the provider-adapter rule. Swapping Stripe = new
  adapter, not edited call sites. Stripe is a *payment* provider — does not touch
  the DeepSeek/Qwen single-AI-provider rules.
- **Purchase**: Stripe Checkout (seats subscription) + metered usage item for
  completed interviews. **Self-serve**: Stripe Customer Portal.
- **Source of truth**: Stripe for subscription state; `stripeWebhook` projects it
  into Appwrite `Subscription`. The app never trusts client-reported plan state.
- **Metering** (borrowed shape from PostHog `quota_limiting.py`, simplified):
  - capture per completed interview (append-only `UsageEvent`)
  - aggregate on a CRON Function (PostHog uses Celery `usage_report.py`; we reuse
    the ADR-0005 scheduled-Function pattern)
  - `QuotaState.hardCeiling = includedInterviews + overageBuffer` (overage policy
    PRD-pending); over-ceiling -> `state=over` -> `issueLivekitToken` blocks.
  - **never_drop_data**: over-quota never deletes/hides existing data (PostHog posture).
- **Secrets**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` server-only in
  `main.ts`, `maskSecret` in logs, registered in the
  `errors-and-observability.md` flag/secret table + `.env.example`.

## 5. Migration (FR-W2)

A new idempotent, reversible step in `packages/appwrite-schema` apply tooling:

1. For each existing researcher account, create a personal Workspace (Team) they
   own (deterministic `ws_${userId}`).
2. Backfill `workspaceId` + `authorId` on all their owner-scoped rows.
3. Re-issue document permissions to team-read + author-write.
4. Verify: no row left without a `workspaceId`; counts match pre-migration.

Non-destructive by default (`appwrite-schema` rule); a dry-run diff first. The
legacy `ownerUserId` field is kept and read during rollout, removed only after
all consumers move to `authorId` (deprecation pattern).

## 6. Frontend (`apps/web`) — scenes

Follows Mauve Quiet design system; borrows PostHog `products/*/frontend/scenes`
shape (scene + logic split), implemented as Next.js App Router routes + hooks.

| Scene | Route | Notes |
|---|---|---|
| Workspace switcher | shell (sidebar brand row) | switch current workspace; persists in user prefs |
| Members & seats | `/settings/members` | owner/admin: invite, role, seat usage `N/seats` |
| Billing | `/settings/billing` | owner: plan (Plus/Pro), Stripe Customer Portal embed, usage meter |
| Plan gating | cross-cutting | `Plan.features[]` drives disabled/locked UI; enforcement still server-side |

Read-shared/write-private surfaces: a study a member doesn't author renders
read-only (no edit affordances), driven by `authorId === currentUser`.

## 7. Testing (per `testing.md`, same PR as each slice)

Property suites in `tests/properties/` for the §6-requirements invariants:
tenant isolation, seat-cap concurrency, billing idempotency, quota gate,
Stripe-webhook idempotency + signature, single-owner role invariant, secret
leakage. Pure-core handlers get 100% branch coverage with in-memory deps; the
Stripe adapter is faked (no live keys in CI; live behind `MERISM_LIVE_TESTS=1`).
