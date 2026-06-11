# packages/appwrite-schema

Per-module supplement to root `AGENTS.md`. Read root `AGENTS.md`, `.kiro/steering/architecture.md`, and `.kiro/steering/contracts.md` first. This file holds ONLY rules specific to this package.

## File map

| File | Owns |
|---|---|
| `src/schema.ts` | Declarative collections + attributes + indexes + permissions + storage buckets. The single source of truth for the Appwrite database surface. |
| `src/apply-schema.ts` | Idempotent, non-destructive `apply` tooling. Diffs declared vs live, applies additions/changes, does not drop data unless an explicit destructive flag is passed. |
| `src/verify-schema.ts` | Read-only `verify` — confirms live Appwrite matches declaration, prints diff, exits non-zero on mismatch. Used in CI. |
| `src/client.ts` | Thin Appwrite SDK client builder. |
| `src/index.ts` | Public re-exports. |
| `test/schema.test.ts` | Declaration-level tests (shape, permission grants, bucket constraints). |

## Module-specific rules (binding)

- The schema is **declared as data**. New collections / attributes / indexes / buckets MUST be added to `src/schema.ts`, never created ad-hoc through the SDK.
- `apply` is **idempotent and non-destructive by default**. Re-running `pnpm schema:apply` on an up-to-date stack MUST be a no-op. Destructive operations (drop attribute, drop collection) require an explicit operator flag and a migration note.
- `verify` is **read-only**. It MUST NOT call any write API. CI relies on this.
- Permission grants follow least privilege:
  - Researcher-owned collections (`surveys`, `survey_sections`, `question_blocks`, `interview_links`, `analysis_reports`, `notebooks`, `dashboards`, ...): `Permission.read(Role.user(ownerUserId))` and matching write/update/delete on the same role only.
  - Anonymous role: read-only on a strict whitelist; never write.
  - Functions are the only write path for anonymous interviewees (see `apps/functions/issueLivekitToken`).
- Storage bucket declarations carry MIME-type and size limits matching the documented use (e.g. recordings: audio + video MIME, max bytes).
- Indexes MUST be declared next to the collection that owns them. Implicit secondary indexes from queries are not allowed — every `Query.equal` / `Query.search` field that hits production traffic needs a declared index.

## Cross-module change triggers

| If you change | You MUST also update |
|---|---|
| Add / rename a collection | Mirror in `packages/contracts/src/entities.ts`, update consumers via `find_references`, run `pnpm schema:verify` against local stack |
| Add / rename an attribute | Update the corresponding zod schema in `packages/contracts`, mirror the change to `apps/agent/agent/contracts.py` if the agent uses it, update Function handlers and tests |
| Change a permission grant | Re-run the property tests in `tests/properties/` covering the permission matrix; verify anonymous-role writes still fail |
| Add a new index | Confirm the corresponding `Query.*` site exists; benchmarking is OPTIONAL but encouraged |
| Add a storage bucket | Update the consuming Function (`save_recording`, etc.) and the bucket-permission property tests |

## Anti-patterns specific to this module

- Editing the Appwrite Console manually and forgetting to declare the change here. The console is **derived from this file**, not vice versa.
- Adding a field with a wide permission grant ("for now, let's allow `Role.users()` to read it") that you intend to tighten "later". Tighten now.
- Skipping a unique index on a deterministic id (e.g. session `$id` candidates) — the concurrency contract in `architecture.md` depends on these.
- Calling Appwrite write APIs from `verify-schema.ts`. CI will not catch this until production drifts.

## Enforcement (per-module)

```bash
pnpm -F @merism/appwrite-schema typecheck
pnpm -F @merism/appwrite-schema test
# Apply against the local Docker stack (idempotent):
pnpm schema:apply
# Read-only diff (used in CI):
pnpm schema:verify
```

A schema change without a passing `pnpm schema:verify` against a real local stack is not ready to merge.
