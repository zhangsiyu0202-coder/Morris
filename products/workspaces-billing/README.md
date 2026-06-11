# Workspaces & Billing

> **Vertical-slice product** turning Merism from a single-researcher tool into a
> **multi-tenant commercial cloud SaaS**. Borrowed in shape from PostHog's
> `products/<name>/` vertical slices; mapped onto Merism's pnpm + Appwrite +
> Next.js stack. Governing decision: **`docs/adr/0006-workspaces-seats-plans-and-usage-billing.md`** (Accepted).

## What it is

- **Workspace** = the tenant boundary (one paying entity), on **Appwrite Teams**.
- **Roles**: `owner` (creator/payer) · `admin` (governance) · `member` (seat-limited researcher).
- **Access**: read-shared within the workspace, **write-private to the author** — B reads A's study, never edits it. No co-editing.
- **Plans**: `Plus` / `Pro` (entitlements + feature flags + usage allowance).
- **Billing**: seat subscription + usage; the billable unit is a **completed interview session**, via **Stripe directly**.
- **Metering/quota**: scheduled aggregator Function + a `quotaState` gate at `issueLivekitToken`. Over-quota blocks new interviews, **never deletes data**.

## Why this folder differs from PostHog

PostHog co-locates a product's Django app + React frontend inside
`products/<name>/{backend,frontend}/`. Merism **cannot** mirror that literally:
its backend is a set of independently-deployed **Appwrite Functions**
(`apps/functions/*`), its cross-module types live in **`packages/contracts`**,
and its UI is **`apps/web`** (Next.js App Router). So this folder is the
product's **spec + design + charter hub and code-location map**, not a runnable
package. The authoritative "where does the code live" list is `product.yaml`
`code_locations`.

## Folder structure

```txt
products/workspaces-billing/
  product.yaml         # manifest + code-location map (machine-readable index)
  AGENTS.md            # operating charter (binding rules for agents in this workstream)
  README.md            # this file
  spec/
    requirements.md    # problem, goals, roles, the model, functional reqs + acceptance criteria
    design.md          # data model, Appwrite Teams mapping, Functions, frontend scenes, Stripe + metering, migration
    tasks.md           # build-order milestones, each slice with its mandatory property tests
```

## Reading order

1. `docs/adr/0006-*.md` — the architecture decision (read first; it is the source of truth).
2. `AGENTS.md` — the binding operating rules for this workstream.
3. `spec/requirements.md` -> `spec/design.md` -> `spec/tasks.md`.

## Status

`spec` — authoring the spec. No contract/schema/scope-guard change has landed;
ADR 0006 is the gate that unblocks implementation. Pricing specifics
(`Plus`/`Pro` amounts, included allowances, overage) are **PRD-pending** (run
`bmad-prd` before launch).
