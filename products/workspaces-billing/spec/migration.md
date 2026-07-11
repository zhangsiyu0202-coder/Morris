# Migration runbook — single-researcher → workspaces (ADR 0006)

> **Stack-gated deploy task.** This migration touches live data (Appwrite Teams
> + bulk document backfill + per-document permission re-issue). It cannot be
> unit-verified; it runs against a live Appwrite stack and is exercised under
> `MERISM_LIVE_TESTS=1` per `testing.md`. Schema columns it depends on already
> shipped (M2-a/M2-b). Execution is written + run when deploying, not blind.

## Preconditions

- Contracts tenancy fields shipped (optional `workspaceId`/`authorId`).
- Schema declares the workspace/billing collections + tenancy attributes (M2-a/M2-b).
- `pnpm schema:apply` has created the new collections + attributes on the stack.

## Steps (idempotent, reversible, dry-run first)

1. **Enumerate accounts** via the Appwrite Users API.
2. **Per account → personal Workspace**: create an Appwrite Team with a
   deterministic id `ws_<userId>` (409 on re-run = already migrated, skip). The
   account becomes the Team `owner`; write a `workspace_memberships` view row.
3. **Seed a trial `Subscription`** stub (planKey per launch default) for the workspace.
4. **Backfill** `workspaceId = ws_<userId>` and `authorId = ownerUserId` on every
   owner-scoped document the account owns (batched, idempotent — skip rows already set).
5. **Re-issue per-document permissions** to team-read + author-write:
   `read(Role.team(ws_<userId>))`, `update/delete(Role.user(authorId))`.
6. **Verify**: no owner-scoped row left without `workspaceId`; pre/post counts match.

## Idempotency & reversal

- Deterministic `ws_<userId>` + 409-skip makes re-runs safe.
- Dry-run mode logs the plan (counts per account) and writes nothing.
- Reversal: drop the backfilled fields + restore owner-scoped permissions; Teams
  created by the migration are removed only with an explicit destructive flag.

## Non-destructive guarantee

Per the `appwrite-schema` rule, default apply is additive; the migration never
deletes researcher data. Over-quota/cancel handling (separate, M6) also never
deletes — it blocks new interviews only.
