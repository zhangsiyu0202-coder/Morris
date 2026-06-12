# ADR 0006: Workspaces, Seats, Plans, and Usage Billing

Date: 2026-06-11

## Status

**Accepted** (2026-06-11). Approved by the product owner (Jia).

This reverses founding scope decisions, so the implementing PRs must (per
`scope.md`) re-narrow `scope.md` and the `pnpm scope-guard` blocklist in the
same PR that introduces each lifted concept — moving the listed concepts from
"permanent exclusion" to "in-scope, governed by ADR 0006" while keeping the
still-forbidden concepts blocked. No contract / schema / scope-guard change has
landed yet; this ADR is the gate that unblocks them.

This ADR **reverses permanent product-shape exclusions** recorded in
`.kiro/steering/scope.md`. Until it is **Accepted**, no contract, schema,
Function, or `scope-guard` change may land. Acceptance is the gate that
`scope.md` itself requires:

> "If a request appears to require one of [teams / billing / quotas / plans /
> seats / usage metering], STOP and open an ADR proposing an architecture
> change BEFORE any contract change."

Exclusions this ADR lifts (and only these):

- Teams / organizations / **workspaces** (a single tenant boundary above the user)
- Billing / subscriptions / **plans / tiers** (Plus / Pro)
- **Seats** (member-count entitlement)
- **Usage metering** (billable interview count)
- RBAC beyond `owner` + `anonymous` — narrowed to a **three-role** model
  (`owner` / `admin` / `member`), NOT PostHog-style per-resource RBAC.

Exclusions this ADR explicitly does **NOT** lift (still forbidden):

- Multi-user **collaborative editing** (studies stay single-author; see D3).
- Sharing / commenting / mentions across workspaces.
- A public marketplace / template gallery of surveys.
- Persistent interviewee accounts (interviewees stay accountless).
- Per-resource RBAC, custom roles, the org -> project -> team 3-tier hierarchy,
  self-host + license keys (see "Alternatives rejected").

## Context

Merism was founded as a **single-researcher** product: `ownerUserId` is the only
tenancy boundary, and `foundation-setup/design.md` plus `scope.md` deliberately
exclude every commercial / multi-user concept. This ADR proposes the deliberate
reversal of that founding decision: Merism becomes a **multi-tenant commercial
cloud SaaS** with paid workspaces.

The product owner's model (verbatim intent, 2026-06-11):

- One **workspace**; **seats** cap the member count.
- A workspace has **admins** and **members**.
- Everyone in a workspace can create studies and write reports, but there is
  **no co-editing**: A's study is **readable** by B, **not editable** by B.
- Billing = **(number of studies) x (interviews executed per study)** -- i.e. the
  billable unit is a **completed interview session**, summed across the
  workspace -- on top of a **seat** subscription. Plans: **Plus** and **Pro**.

The reference implementation studied is **PostHog** (`/home/jia/posthog`), a
production multi-tenant analytics SaaS. We borrow its **shape and design
trade-offs**, not its code, and we **simplify to roughly one-third** of its
machinery: PostHog's three-tier tenancy, per-resource RBAC, external billing
microservice, and dual cloud/self-host deployment are each more than Merism's
volume and team size warrant (see "PostHog references" and "Alternatives
rejected"). Borrowed shapes are renamed for the Merism domain per the
`scope.md` borrow-or-build rule.

This is the largest architectural change since foundation: it touches
`packages/contracts`, `packages/appwrite-schema`, every owner-scoped Function,
the agent's session-completion path, and the web app's navigation shell. It is
therefore an architecture-order change governed by `architecture.md`
(contracts -> schema -> functions -> agent -> web, single PR per cohesive slice)
and `pre-implementation.md` (no-MVP: each slice ships with its error paths,
tenant-isolation property tests, and rollback in the same PR).

## Decisions

### D1: The Workspace is the tenant boundary, backed by Appwrite Teams

A new **`Workspace`** is the root scoping entity. It **replaces `ownerUserId`**
as the ownership root for every researcher-owned entity (`Survey`, `Project`,
`InterviewLink`, `InterviewSession`, `Recording`, `AnalysisReport`, `Notebook`,
`Dashboard*`). Those entities gain a `workspaceId: z.string()` field; the legacy
`ownerUserId` is retained as the **author** of the row (who created it), not the
tenant key (see D3).

The tenancy primitive is **Appwrite Teams** -- Appwrite's native construct for
"a set of users with roles, plus team-scoped document permissions". This is the
borrow-shape-and-rename decision: a `Workspace` *is* an Appwrite Team
(`teamId === workspaceId`), and document permissions use
`Permission.read(Role.team(workspaceId))` + `Permission.update(Role.user(authorId))`
to express D3's access model declaratively. No bespoke membership table is
invented where Appwrite Teams already serves the purpose
(`architecture.md` "optimize technology, never change its purpose").

Anonymous interviewees remain **outside** all workspaces and teams -- they reach
a session only through `issueLivekitToken` exactly as today; the workspace is a
researcher-side concept only.

Rejected -- keeping `ownerUserId` as tenant and adding a parallel `members[]`
array: Appwrite Teams already implements membership, invites, and role grants
with server-enforced permissions; a hand-rolled array would duplicate it and
bypass Appwrite's permission engine.

### D2: Three roles -- `owner` / `admin` / `member` -- seat-limited

Workspace membership has exactly three levels (Appwrite Team roles):

| Role | Granted to | Can |
|---|---|---|
| `owner` | The workspace creator / payer (exactly one) | Everything `admin` can, plus manage billing, change plan, delete the workspace, transfer ownership |
| `admin` | Appointed by owner (0..N) | Manage members/seats/invites, govern content (archive/delete any study -- NOT edit, see D3), workspace settings |
| `member` | Invited researchers (seat-limited) | Create studies, run interviews, write reports, read all workspace studies/reports |

`owner` is the single billing principal (mirrors who holds the payment method).
Seats are an entitlement from the plan (D4): `activeMemberCount <= plan.seats`.
Inviting beyond the seat cap is rejected at the Function boundary with a typed
error (`seat_limit_reached`) -- the invite Function checks the cap as a
deterministic precondition, not a UI-only guard.

This is intentionally **flatter than PostHog** (`OrganizationMembership.Level`
MEMBER/ADMIN/OWNER **plus** a separate paid per-resource RBAC layer). Merism
ships only the three coarse roles; per-resource access control is explicitly
out of scope (see "Alternatives rejected").

### D3: Access model -- read-shared within workspace, write-private to author

Inside a workspace, content is **read-shared, write-private**:

- **Read**: every member can read every study, report, and notebook in the
  workspace (`Permission.read(Role.team(workspaceId))`).
- **Write / edit**: only the **author** (`authorId`, the creating user) can edit
  or delete their own study/report (`Permission.update/delete(Role.user(authorId))`).
- **Admin governance**: `admin`/`owner` may **archive or delete** any study for
  lifecycle governance, but may **NOT edit its content**. Governance is a
  distinct capability (a status transition + delete), enforced in the Function
  layer, not a blanket write grant on the document.

This encodes the owner's "B can see but not edit" requirement exactly and keeps
the "no collaborative editing" exclusion intact: there is never a path where two
users mutate the same study body. It is a deliberate, narrow widening of the
permission model -- from "owner-only read+write" to "workspace read, author
write" -- and nothing more.

Tenant isolation is the new top invariant: a user in workspace X can never read
or write any row whose `workspaceId !== X`. This becomes a mandatory
property-based test (see Consequences) alongside the existing anonymous-role and
secret-leakage properties in `tests/properties/`.

### D4: Plans -- `Plus` and `Pro` -- entitlement + price tier

A `Plan` is a named bundle of **entitlements** (seat allowance, feature flags,
usage allowance / price). Two plans ship: **Plus** and **Pro**. The plan drives
both UI gating and Function-level enforcement via a `Plan.features[]` flag list
(borrowed from PostHog's `AvailableFeature` enum shape, renamed and trimmed to
Merism features only).

| Field (shape, not final values) | Meaning |
|---|---|
| `key: "plus" \| "pro"` | Plan identifier |
| `seats: number` | Included seats (overage / add-on seats: PRD-pending) |
| `features: PlanFeature[]` | Capability flags (e.g. `visual_analysis`, `survey_rollup`, larger limits) |
| `includedInterviews: number` | Usage allowance per billing period before per-unit charges |
| `priceRef` | Stripe Price id reference (dollar amounts live in Stripe, not the repo) |

**Exact dollar amounts, seat prices, included-interview allowances, and the
Plus/Pro feature split are `PRD-pending`** -- they are a pricing decision, not an
architecture decision, and belong in a `bmad-prd` artifact before launch. This
ADR fixes only the *shape* and the *enforcement mechanism*.

### D5: Billing = seats (subscription) + usage (completed interviews), via Stripe directly

Two billing dimensions:

1. **Seats** -- a recurring subscription priced per included-seat band of the
   plan (Plus/Pro).
2. **Usage** -- the **completed interview session** is the billable unit. Per the
   owner's formula, workspace usage in a period = `sum over studies of
   (completed interviews in that study)`. A session counts when it reaches
   `state=completed` (the interviewee actually finished), **not** when started --
   so an abandoned join is never charged.

The billing integration is **Stripe directly** (Checkout for plan purchase,
Customer Portal for self-serve plan/seat changes, Webhooks for
subscription-state sync, and usage reporting via Stripe metered billing or
invoice items). Merism does **NOT** build a separate billing microservice; that
is PostHog's choice for its scale and is rejected here (see "Alternatives
rejected"). Stripe is a new external provider and its keys follow
`errors-and-observability.md` secret rules (server-only, `maskSecret`, never in
`handler.ts` pure cores).

> Note: Stripe is a billing/payment provider, NOT an LLM/ASR/TTS provider, so the
> "single LLM provider (DeepSeek) / single ASR-TTS provider (Qwen)" rule in
> `architecture.md` is untouched. No second AI provider is introduced.

### D6: Usage metering + quota = scheduled aggregator Function + entry-gate, never delete data

Metering reuses the **scheduled-Function** pattern just shipped for
`sweepGeminiFiles` (ADR 0005), rather than PostHog's Celery + Redis-zset machine:

- **Capture**: when a session reaches `state=completed`, a billable
  `UsageEvent` row is written (append-only) keyed by `workspaceId` + `studyId` +
  `sessionId`. Idempotent on `sessionId` (a session is billed at most once).
- **Aggregate**: a scheduled Function (`aggregateWorkspaceUsage`, CRON) rolls
  `UsageEvent`s into a per-workspace-per-period `UsageCounter` and reports usage
  to Stripe.
- **Enforce**: each workspace carries a `quotaState` (derived from plan allowance
  vs current usage). Functions that *start new spend* -- principally
  `issueLivekitToken` (a new interview = a new billable unit) -- check
  `quotaState` at the boundary and reject with `quota_exceeded` over the hard
  ceiling.
- **Degrade, never destroy**: over-quota **blocks new interviews**; it never
  deletes or hides existing studies, reports, or recordings. (PostHog's
  `never_drop_data` posture, borrowed.)

The `quotaState` check is a deterministic precondition at the Function boundary,
consistent with the `architecture.md` concurrency contract -- no in-memory
counters as the gate.

### D7: Contract + schema change surface (shape only; values/migration in implementing PRs)

Per `contracts.md` and `architecture.md` cross-module order, the change lands
contracts-first. New / changed shapes (names indicative):

- **New entities** (`packages/contracts/src/entities.ts` or a new `billing.ts`):
  `Workspace`, `WorkspaceMembership` (role enum `owner|admin|member`), `Plan`,
  `PlanFeature`, `Subscription`, `UsageEvent`, `UsageCounter`, `QuotaState`.
- **Changed entities**: add `workspaceId` (tenant key) + recast `ownerUserId` as
  `authorId` on `Survey`, `Project`, `InterviewLink`, `InterviewSession`,
  `Recording`, `AnalysisReport`, `Notebook`, `Dashboard*`. Add `superRefine` for
  the new tenant invariant where cross-field rules apply.
- **New API payloads** (`api.ts`): `CreateWorkspace*`, `InviteMember*`
  (+ `seat_limit_reached`), `ChangePlan*`, `StripeWebhook*`, `aggregateUsage*`,
  and a `quota_exceeded` error code added to the error registry
  (`errors-and-observability.md`).
- **Python mirror** (`apps/agent/agent/contracts.py`): the agent needs
  `workspaceId` on `InterviewSession` and the `UsageEvent` emit shape at
  completion; mirror only those fields (identical camelCase names).

### D8: Schema, Functions, agent, web mapping

- **appwrite-schema** (`packages/appwrite-schema/src/schema.ts`): workspaces
  modeled via **Appwrite Teams**; new collections (`plans`, `subscriptions`,
  `usage_events`, `usage_counters`, `workspace_quota`); permission model switched
  to team-read + author-write per D3; a one-time **migration** that wraps each
  existing single-researcher account's data into a personal default workspace
  (current owners keep their data, now as a 1-member workspace).
- **Functions** (`apps/functions/*`): new `createWorkspace`, `inviteMember`
  (seat-cap check), `changePlan`, `stripeWebhook` (subscription-state sync),
  `aggregateWorkspaceUsage` (scheduled); `issueLivekitToken` gains the
  `quotaState` + workspace gate; the session-completion path emits the billable
  `UsageEvent`. All keep the pure-core + SDK-wrapper shape.
- **Agent** (`apps/agent`): on `state=completed`, emit the billable usage signal
  through the existing one-way finalize path (no per-turn metering); per-workspace
  isolation of persisted session artifacts.
- **Web** (`apps/web`): workspace switcher in the shell, members/seats admin
  surface, billing page (Stripe Customer Portal embed), plan-gating in the UI
  driven by `Plan.features[]`. Follows the Mauve Quiet design system.
- **Steering reversal** (in the implementing PR, NOT now): edit `scope.md` to
  move the lifted concepts from "permanent exclusions" to "in-scope, governed by
  ADR 0006", and update the `pnpm scope-guard` blocklist to stop flagging
  `workspace/plan/seat/subscription/usage` where this ADR permits them, while
  keeping the still-forbidden concepts (co-editing, marketplace, per-resource
  RBAC) blocked.

## PostHog references (borrowed shape, and how Merism differs)

Studied in the local PostHog checkout (`/home/jia/posthog`). We borrow shape and
trade-offs; we never copy code, and we rename every concept for the Merism domain.

| PostHog artifact (evidence) | What it does there | Merism borrow / difference |
|---|---|---|
| `posthog/models/organization.py`, `project.py`, `team/team.py` | 3-tier `Organization -> Project -> Team` tenancy | Borrow the **tenant boundary** idea; **collapse to 1 tier** (`Workspace`). No project/team sub-levels. |
| `OrganizationMembership.Level` (MEMBER=1/ADMIN=8/OWNER=15) | Coarse membership levels | Borrow the **three coarse roles**; map onto **Appwrite Team roles** (`owner/admin/member`). |
| `ee/models/rbac/*`, `posthog/rbac/user_access_control.py` (`AccessSource`) | Paid **per-resource RBAC** + roles | **Rejected.** Merism uses D3's flat read-shared/write-private instead. |
| `posthog/constants.py::AvailableFeature` | Feature-flag enum gating paid capabilities | Borrow as **`Plan.features[]`**, trimmed to Merism features. |
| `ee/billing/billing_manager.py` (calls `BILLING_SERVICE_URL` with a License JWT) | App is a **client of an external billing microservice** | **Rejected.** Merism talks to **Stripe directly**; no separate billing service at this scale. |
| `ee/billing/billing_types.py` (`Product/ProductPlan/Tier/free_allocation/usage_limit`) | Usage-tiered product/plan shapes | Borrow the **plan/tier/allowance shape** for `Plan`; concrete numbers are PRD-pending and live in Stripe. |
| `ee/billing/quota_limiting.py` (`QuotaResource`, `OVERAGE_BUFFER`, Redis zset, `never_drop_data`) | Per-org usage limiting via Redis caches | Borrow **"meter usage, gate new spend, never drop data"**; implement with an **Appwrite collection + scheduled Function**, not Redis/Celery. |
| `posthog/tasks/usage_report.py` (Celery `@shared_task`) | Periodic per-org usage aggregation | Borrow the **periodic-aggregation** idea; implement as a **scheduled Appwrite Function** (same pattern as `sweepGeminiFiles`). |
| `posthog/rate_limit.py` (`AIBurstRateThrottle 10/min`, signup IP throttles) | DRF throttles for abuse + AI cost control | Out of this ADR's billing scope, but noted as the **in-scope cost-guardrail** follow-up (per-owner LLM ceilings). |
| `posthog/cloud_utils.py::is_cloud()` + License gating | Dual cloud / self-host deployment | **Rejected for now.** Merism ships **cloud-only**; self-host + license is a later ADR if ever. |

## Alternatives rejected

- **PostHog's 3-tier `org -> project -> team`** — Merism has no "product line /
  environment" axis; one `Workspace` tier is sufficient. The extra tiers are pure
  carrying cost.
- **Per-resource RBAC / custom roles** — three coarse roles cover the stated
  model ("everyone creates; author edits; admin governs"). Per-resource ACLs are
  PostHog's paid complexity and would contradict the "no collaborative editing"
  exclusion we are keeping.
- **External billing microservice** (PostHog's `billing.posthog.com`) — justified
  only at PostHog's scale/SKU complexity. Stripe Checkout + Portal + Webhooks
  covers Merism's two-plan model directly; revisit only if SKU logic explodes.
- **Metering on LLM tokens or interview minutes** — the owner chose the
  **completed interview** as the value-aligned billable unit; it is also the
  simplest to meter idempotently (one `UsageEvent` per `sessionId`). Token/minute
  cost control remains available as the separate in-scope guardrail.
- **Ingest-time Redis-zset quota** (PostHog) — Merism's interview volume does not
  need a hot-path cache; a scheduled aggregator + boundary check on
  `issueLivekitToken` is sufficient and stays within the Appwrite-only backend rule.
- **Self-host + license keys** — cloud-only first removes a whole second
  deployment/entitlement surface. A future ADR can add it if demand appears.
- **Hand-rolled membership table instead of Appwrite Teams** — duplicates a native
  Appwrite capability and bypasses its permission engine.

## Consequences

Positive:

- A coherent commercial SaaS shape with the smallest tenancy/billing surface that
  satisfies the owner's model.
- Tenant isolation and billing are enforced **at the Function boundary and in the
  Appwrite permission model**, not in the UI — consistent with existing security
  posture.
- Reuses two already-shipped patterns (scheduled Function from ADR 0005; pure-core
  + SDK-wrapper Function shape) rather than inventing new infrastructure.

Negative / cost:

- This is a **re-platforming**, not a feature: it rewrites the ownership root of
  nearly every entity and Function. It must be sequenced as multiple PRs
  (contracts -> schema+migration -> functions -> agent -> web), each with tests.
- A **data migration** is required (wrap every existing account's data into a
  personal default workspace). Migration must be idempotent and reversible per the
  `appwrite-schema` non-destructive rule.
- New external dependency (**Stripe**) with PCI-adjacent flows, webhook signature
  verification, and secret handling.
- The `scope.md` / `scope-guard` reversal means losing the blanket "no commercial
  concepts" guard; the guard must be **re-narrowed**, not deleted, so the
  still-forbidden concepts (co-editing, marketplace, per-resource RBAC, persistent
  interviewee accounts) stay enforced.

Mandatory new invariants / tests (same PR as the code, per `testing.md`):

- **Tenant isolation property**: a user in workspace X can never read/write any
  row with `workspaceId != X` (new top-tier property in `tests/properties/`).
- **Seat cap property**: N concurrent invites never push `activeMemberCount`
  beyond `plan.seats`.
- **Billing idempotency property**: a session billed at most once regardless of
  retries/concurrency (one `UsageEvent` per `sessionId`).
- **Quota gate property**: over-quota blocks new `issueLivekitToken` and never
  mutates/deletes existing data.
- **Stripe webhook**: signature-verified; replayed events are idempotent.

## Open questions (PRD-pending -- resolve in `bmad-prd` before launch)

1. Exact Plus vs Pro **pricing** (seat price, included interviews, per-overage
   unit price) and the **feature split** between the two plans.
2. **Billing cadence**: monthly usage post-pay vs prepaid interview credits.
   (Owner leaned toward subscription plans; credits remain an option for usage.)
3. **Free tier / trial** existence and limits.
4. **Overage behavior** past the included allowance: hard block vs grace +
   invoice-on-next-cycle.
5. Add-on **seats** beyond the plan band (price + cap).
6. Annual vs monthly discount; currency/tax handling.
7. Precise definition of a **"completed" interview** for billing (minimum
   duration? minimum answered questions?) to prevent trivially-short billable
   sessions and disputes.
8. Ownership **transfer** and workspace **deletion** flows (data retention on
   downgrade/cancel).

## References

- `.kiro/steering/scope.md` — the exclusions this ADR reverses (and the ones it keeps).
- `.kiro/steering/architecture.md` — module map, Function shape, cross-module change order, concurrency contract.
- `.kiro/steering/contracts.md` — contracts-first workflow, `superRefine` invariants, Python mirror discipline.
- `.kiro/steering/errors-and-observability.md` — error code registry (`quota_exceeded`, `seat_limit_reached`), secret masking (Stripe keys).
- `.kiro/steering/pre-implementation.md` — no-MVP rule; per-slice tests + rollback.
- ADR 0001 (interview controller), ADR 0003 (analysis report), ADR 0005 (scheduled-Function / sweep pattern reused for usage aggregation).
- PostHog (`/home/jia/posthog`): files cited in the "PostHog references" table above.
- Appwrite Teams + document permissions (the tenancy + access-model primitive).

## Update 2026-06-11 — pricing locked

The PRD-pending pricing (Open questions §1-§7) is resolved in
`products/workspaces-billing/spec/prd-pricing.md` (status: final): **Plus**
$49/seat/mo + 50 included interviews + $8 overage; **Pro** $99/seat/mo + 200
included + $5 overage; subscription + metered post-pay; 14-day Pro trial, no
perpetual free tier; "completed interview" = `state=completed` + >=60s + >=1
substantive answer; annual ~17% off; hard ceiling 2x allowance trips
`quota_exceeded`; visual analysis + survey rollup are Pro-only. Values remain
revisable via `bmad-prd` (update). This does not change any architecture decision above.
