# Handoff — Workspaces & Billing deployment (ADR 0006)

> Deployment + operational runbook for the workspaces-billing product. The
> code is merged on `feat/studies-workspace` and fully unit-tested; everything
> below needs a live Appwrite + Stripe stack and **cannot be done from the dev
> sandbox**. Read with `spec/requirements.md`, `spec/design.md`, `spec/migration.md`.

## What is built (this branch)

contracts (`packages/contracts/src/billing.ts`), schema (6 billing collections +
`stripe_events` + tenancy attrs), and 6 Functions: `createWorkspace`,
`inviteMember`, `changePlan`, `stripeWebhook`, `aggregateWorkspaceUsage`, plus a
quota gate added to `issueLivekitToken`. Two PostHog-referenced review passes +
property suites are in. Verified: typecheck + tests + scope-guard green.

## Stack-gated remainder (this runbook)

1. Apply schema + seed plans.
2. Stripe setup (products/prices, webhook, secrets).
3. Deploy the Functions + schedule + env + permissions.
4. Run the data migration (`spec/migration.md`).
5. Wire the agent `UsageEvent` emit.

## Prerequisites

- Appwrite stack up; `pnpm schema:apply` available.
- A Stripe account (test mode first).
- Pricing locked in `spec/prd-pricing.md` (Plus $49 / Pro $99 seats; 50 / 200
  included interviews; $8 / $5 overage).

## Step 1 — Schema + seed plans

```bash
pnpm stack:up
pnpm schema:apply          # creates plans/subscriptions/usage_events/usage_counters/
                           # workspace_quota/workspace_memberships/stripe_events + tenancy attrs
pnpm schema:verify         # must exit 0
```

Seed the `plans` catalog (one doc per plan; `$id == key`). `includedInterviews`
comes from the PRD; `priceRef` is the Stripe price id from Step 2:

| $id | includedInterviews | features | priceRef |
|---|---|---|---|
| `plus` | 50 | `["core"]` | `price_...plus` |
| `pro` | 200 | `["core","visual_analysis","survey_rollup"]` | `price_...pro` |

## Step 2 — Stripe setup

1. Create two **Products** (Plus, Pro), each with a recurring **Price** (seat
   subscription). Note the price ids → `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PRO`.
   (Usage/overage as a metered price or invoice item — see prd-pricing.md.)
2. Add a **Webhook endpoint** pointing at the deployed `stripeWebhook` Function
   URL; subscribe to `customer.subscription.created|updated|deleted`. Note the
   signing secret → `STRIPE_WEBHOOK_SECRET`.
3. Keep `STRIPE_SECRET_KEY` server-side only (never logged; `maskSecret`).

## Step 3 — Deploy Functions + schedule + permissions

Build + deploy each `dist/` to Appwrite:

```bash
for fn in createWorkspace inviteMember changePlan stripeWebhook aggregateWorkspaceUsage; do
  pnpm -F @merism/fn-$(echo "$fn" | sed -E 's/([A-Z])/-\L\1/g') build
done
# redeploy issueLivekitToken too (now carries the quota gate)
```

- **Schedule** `aggregateWorkspaceUsage` (CRON), e.g. hourly `0 * * * *` (it
  rolls the current calendar-month period; hourly keeps `quotaState` fresh).
- **Permissions**: each Function's API key needs write on the collections it
  touches; `createWorkspace`/`inviteMember` need the **Teams** scope; the four
  researcher-facing Functions require an authenticated caller (the
  `x-appwrite-user-id` header is set by Appwrite when invoked with a user JWT).
  `stripeWebhook` is **public** (no auth) but gated by signature verification.

### Env vars per Function

| Var | createWorkspace | inviteMember | changePlan | stripeWebhook | aggregateUsage | issueLivekitToken |
|---|---|---|---|---|---|---|
| `APPWRITE_ENDPOINT/PROJECT_ID/API_KEY` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `STRIPE_SECRET_KEY` | | | ✓ | ✓ | | |
| `STRIPE_WEBHOOK_SECRET` | | | | ✓ | | |
| `STRIPE_PRICE_PLUS` / `STRIPE_PRICE_PRO` | | | ✓ | ✓ (plan-from-price) | | |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | | | ✓ | | | |

(`issueLivekitToken` keeps its existing LiveKit env; no new vars — the quota
gate reads `workspace_quota` via the Appwrite key it already has.)

## Step 4 — Data migration

Run `spec/migration.md` (idempotent, reversible, dry-run first): personal
Workspace (Appwrite Team `ws_<userId>`) per existing account, backfill
`workspaceId`/`authorId`, re-issue team-read/author-write document permissions,
seed a trial Subscription + a `workspace_quota` row per workspace.

## Step 5 — Agent UsageEvent emit (remaining code)

On `state=completed`, the agent's one-way finalize path must write one
`UsageEvent` (idempotent id `ue_<sessionId>`) keyed by `workspaceId` (now on the
session) + `studyId` + `sessionId`, gated by the contract predicate
`isBillableInterview({ state, durationMs, answeredCount })`. This is the only
remaining production code; it lives in `apps/agent` persistence and is
stack/agent-tested. The contract predicate + collection are already shipped.

## Open product decisions (block nothing technical, but affect behavior)

1. **Does the owner consume a seat?** Today `inviteMember` counts only invitees;
   the owner is not a seat slot. If owner-consumes-seat is desired,
   `createWorkspace` should also claim seat slot 0.
2. **Reject seat downgrade below active members?** Seat *quantity* changes happen
   in the Stripe Customer Portal (not `changePlan`, which only switches Plus↔Pro
   tier). Enforcing "can't drop below active members" needs a Portal
   configuration constraint or a dedicated seat-management Function.
3. **Quota fail-open before first aggregation:** the gate treats a missing
   `workspace_quota` row as `ok`. Step 4 seeds a row per workspace so this only
   matters for brand-new workspaces created after migration but before the next
   CRON tick. Accept, or seed a row in `createWorkspace`?

## Verification (on the stack)

```bash
pnpm schema:verify                              # 0
# create a workspace via createWorkspace -> Team + owner membership + trial sub
# invite up to `seats` members; the (seats+1)th -> 409 seat_limit_reached
# drive a completed interview -> one usage_events row (idempotent on sessionId)
# run aggregateWorkspaceUsage -> usage_counters + workspace_quota updated
# push past 2x allowance -> issueLivekitToken returns 402 quota_exceeded (new interviews only)
# replay a Stripe webhook event -> acked, applied once (stripe_events dedup)
MERISM_LIVE_TESTS=1 pnpm test:properties        # incl. the gated tenant-isolation permission matrix
```

## Rollback / safety

- No destructive defaults: migration is additive + reversible; over-quota only
  blocks new interviews and never deletes researcher data (never_drop_data).
- Billing kill switch: unset the Stripe envs / pause the webhook — researcher
  features keep working; only plan changes + metered overage stop.
- `pnpm scope-guard` stays green: collaboration concepts remain forbidden;
  workspaces/billing concepts are scoped to this product surface only.
