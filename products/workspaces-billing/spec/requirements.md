# Workspaces & Billing — Requirements

> Status: **Draft** (2026-06-11). Governed by `docs/adr/0006-workspaces-seats-plans-and-usage-billing.md` (Accepted).
> Reference implementations studied: PostHog `products/user_interviews`, `products/surveys`, `ee/billing/*` (`/home/jia/posthog`). Borrow shape, never code.
> Pricing values are **PRD-pending** — this doc fixes behavior and acceptance criteria, not dollar amounts.

## 1. Problem & motivation

Merism today is a single-researcher tool: `ownerUserId` is the only tenancy
boundary and there is no commercial layer. To sell Merism as a product, a team
of researchers must be able to share one paid account, and usage must be metered
and billed. This product introduces **paid, multi-researcher workspaces** with
**seats**, **plans (Plus/Pro)**, and **usage billing on completed interviews**,
without turning studies into collaboratively-edited documents.

## 2. Goals / non-goals

**Goals**

- G1. A workspace groups multiple researchers under one billing account.
- G2. Seats cap the number of active members; the plan sets the cap.
- G3. Every member can create studies/reports and **read** all workspace
  content; only the **author** can edit their own content.
- G4. Two plans (Plus/Pro) gate features and usage allowance.
- G5. Billing = recurring seat subscription + usage on **completed interview
  sessions**, charged through Stripe.
- G6. Usage is metered idempotently and enforced as a quota that blocks new
  interviews when exceeded — **without ever deleting researcher data**.
- G7. Strict tenant isolation: no cross-workspace read or write, ever.

**Non-goals (explicitly out — see ADR 0006 / `scope.md`)**

- N1. Collaborative / simultaneous editing of a study. (Read-shared, write-private only.)
- N2. Per-resource RBAC, custom roles, or a 4th role.
- N3. The PostHog `org -> project -> team` 3-tier hierarchy (Merism is one tier).
- N4. An external billing microservice (Stripe direct only).
- N5. Cross-workspace sharing/commenting/mentions, a survey marketplace, or
  persistent interviewee accounts. Interviewees stay accountless and outside
  every workspace.
- N6. A second LLM/ASR/TTS provider (Stripe is a payment provider only).
- N7. Self-host + license keys (cloud-only first).

## 3. Personas & roles

| Persona | In a workspace? | Summary |
|---|---|---|
| **Owner** | Yes — exactly one | Creator + payer. Manages billing/plan, can delete the workspace, transfer ownership. Superset of admin. |
| **Admin** | Yes — 0..N | Manages members/seats/invites and workspace settings; governs content (archive/delete any study) but **cannot edit** another author's content. |
| **Member** | Yes — seat-limited | Creates studies, runs interviews, writes reports; reads all workspace content; edits only their own. |
| **Anonymous interviewee** | **No** | Accountless; reaches a session only via `issueLivekitToken`. Entirely outside the workspace/billing model. Unchanged from today. |

## 4. The model

```
Workspace (Appwrite Team; the tenant + billing entity)
├─ Subscription (Stripe) -> Plan (plus | pro): seats, features[], includedInterviews
├─ Members (Appwrite Team memberships): owner(1) / admin(0..N) / member(seat-limited)
├─ Studies / Reports / Notebooks  (authorId = creator; workspaceId = tenant key)
│    read  : every workspace member
│    write : author only        (admin may archive/delete, NOT edit)
└─ Usage
     UsageEvent  : one per completed interview session (idempotent on sessionId)
     UsageCounter: per workspace per billing period (aggregated)
     QuotaState  : derived; gates new interviews at issueLivekitToken
```

- **Billable unit**: a session that reaches `state=completed`. A started-then-
  abandoned join is never billed.
- **Workspace usage in a period** = sum over the workspace's studies of
  completed interviews = the owner's "studies × interviews-per-study" formula.

## 5. Functional requirements & acceptance criteria

Acceptance criteria use Given/When/Then. Each FR group maps to code locations in
`product.yaml`. Per `pre-implementation.md` (no-MVP), every FR ships with its
error paths, concurrency safety, rollback, and tests in the same PR.

### FR-W — Workspace lifecycle

- **FR-W1** Create workspace. *Given* an authenticated researcher, *when* they
  create a workspace, *then* an Appwrite Team is created with them as `owner`, a
  default `Plus` (trial/PRD-pending) subscription stub, and `workspaceId` is
  returned. Concurrent creates with the same idempotency key produce one team.
- **FR-W2** Default personal workspace (migration). *Given* an existing
  single-researcher account, *when* the migration runs, *then* their data is
  wrapped into a 1-member workspace they own; no data is lost; the migration is
  idempotent and reversible.
- **FR-W3** Delete workspace. *Given* an `owner`, *when* they delete the
  workspace, *then* the subscription is canceled in Stripe and data is retained
  per the retention policy (PRD-pending); **only `owner`** may delete.

### FR-M — Membership & seats

- **FR-M1** Invite member. *Given* an `owner`/`admin` with `activeMembers <
  plan.seats`, *when* they invite an email, *then* an Appwrite Team invite is
  created. *Given* `activeMembers == plan.seats`, *when* they invite, *then* the
  Function rejects with `seat_limit_reached` (boundary check, not UI-only).
- **FR-M2** Seat-cap concurrency. *Given* `plan.seats = N` and 1 free seat,
  *when* M invites are accepted concurrently, *then* exactly 1 succeeds and the
  rest get `seat_limit_reached`; `activeMembers` never exceeds `N`.
- **FR-M3** Role assignment. *Given* an `owner`, *when* they set a member's role
  to `admin`/`member`, *then* the Appwrite Team role updates. Only `owner` can
  grant/revoke `admin`. There is always exactly one `owner`.
- **FR-M4** Ownership transfer. *Given* the `owner`, *when* they transfer to an
  `admin`, *then* roles swap atomically; the workspace always has one `owner`.

### FR-A — Access control (read-shared, write-private)

- **FR-A1** Workspace read. *Given* a member of workspace X, *when* they read any
  study/report/notebook with `workspaceId == X`, *then* it is allowed
  (`Permission.read(Role.team(X))`).
- **FR-A2** Author write. *Given* user U, *when* U edits a study, *then* it is
  allowed only if `authorId == U`; otherwise rejected (`Permission.update(Role.user(authorId))`).
- **FR-A3** Admin governance. *Given* an `admin`/`owner`, *when* they archive or
  delete another author's study, *then* it is allowed as a governance action
  (status transition / delete) — but editing the study **body** is never allowed
  for non-authors.
- **FR-A4** Tenant isolation. *Given* user U in workspace X only, *when* U
  attempts any read/write on a row with `workspaceId != X`, *then* it is denied.
  (Top-tier invariant; see §6.)

### FR-P — Plans & entitlements

- **FR-P1** Plan drives features. *Given* a workspace on plan P, *when* a
  feature flag in `Plan.features[]` is absent, *then* the gated capability is
  unavailable in both UI and Function enforcement (not UI-only).
- **FR-P2** Change plan. *Given* an `owner`, *when* they upgrade/downgrade
  (Plus<->Pro), *then* Stripe is updated via Customer Portal/Checkout and the
  workspace `seats`/`features`/`includedInterviews` reflect the new plan after
  webhook sync. Downgrade below current `activeMembers` is rejected with a clear
  error until seats are freed.

### FR-B — Billing (Stripe direct)

- **FR-B1** Purchase. *Given* an `owner`, *when* they subscribe, *then* Stripe
  Checkout creates the subscription and the `stripeWebhook` syncs
  `Subscription` state to Appwrite. Secrets stay server-side (`maskSecret`).
- **FR-B2** Self-serve management via Stripe Customer Portal (seats, payment
  method, cancel).
- **FR-B3** Webhook idempotency. *Given* a Stripe webhook event, *when* it is
  delivered (including replays/duplicates), *then* it is signature-verified and
  applied at most once.

### FR-U — Usage metering & quota

- **FR-U1** Capture. *Given* a session reaching `state=completed`, *when*
  completion is finalized, *then* exactly one `UsageEvent` is written
  (idempotent on `sessionId`), keyed by `workspaceId`+`studyId`+`sessionId`.
- **FR-U2** Aggregate. *Given* the scheduled `aggregateWorkspaceUsage` Function,
  *when* it runs, *then* it rolls `UsageEvent`s into the period `UsageCounter`
  and reports usage to Stripe.
- **FR-U3** Quota gate. *Given* a workspace over its hard ceiling, *when*
  `issueLivekitToken` is called to start a new interview, *then* it rejects with
  `quota_exceeded`. Within allowance, it proceeds.
- **FR-U4** Degrade, never destroy. *Given* an over-quota workspace, *then*
  existing studies/reports/recordings remain fully readable; only **new
  interviews** are blocked.

## 6. Mandatory invariants → property tests (per `testing.md`, same PR)

| Invariant | Property |
|---|---|
| Tenant isolation | A user in workspace X can never read/write any row with `workspaceId != X`. |
| Seat cap | N concurrent accepted invites never push `activeMembers` beyond `plan.seats`. |
| Billing idempotency | A session is billed at most once across retries/concurrency (one `UsageEvent` per `sessionId`). |
| Quota gate | Over-quota blocks new `issueLivekitToken`; mutates/deletes nothing. |
| Stripe webhook | Signature-verified; replayed events idempotent. |
| Role invariant | Exactly one `owner` at all times; only `owner` grants `admin`. |
| Secret leakage | No Stripe key / webhook secret in any log, response, or snapshot. |

## 7. Out of scope (kept forbidden — do not drift)

Re-states ADR 0006 / `scope.md`: no co-editing, no per-resource RBAC, no
3-tier hierarchy, no billing microservice, no cross-workspace social surface, no
survey marketplace, no persistent interviewee accounts, no second AI provider,
no self-host/license. A request for any of these needs a new ADR.

## 8. Open questions (PRD-pending — resolve via `bmad-prd` before launch)

1. Plus vs Pro pricing (seat price, included interviews, per-overage unit) and feature split.
2. Billing cadence: monthly usage post-pay vs prepaid interview credits.
3. Free tier / trial existence and limits.
4. Overage behavior past allowance: hard block vs grace + invoice-next-cycle.
5. Add-on seats beyond the plan band (price + cap).
6. Annual vs monthly discount; currency/tax handling.
7. Precise "completed interview" definition for billing (min duration / min answered questions) to prevent trivially-short billable sessions.
8. Workspace deletion + ownership-transfer data-retention policy.

---

**Resolved 2026-06-11**: the §8 pricing open questions are locked in
`spec/prd-pricing.md` (status: final). See that PRD for the Plus/Pro numbers,
billing cadence, trial, and the "completed interview" definition.
