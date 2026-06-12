/**
 * ADR-0006 NFR-3 — one-time migration: ensure every existing researcher account
 * has a personal default Workspace (Appwrite Team), so the multi-tenant model
 * applies uniformly. This is the COMPLEMENT to scripts/backfill-workspace-tenancy.ts:
 *
 *   1. THIS script provisions a default workspace per owner who has none
 *      (Team + owner membership + seat-0 reservation + trial subscription + quota).
 *   2. THEN run `scripts/backfill-workspace-tenancy.ts` to tag that owner's
 *      existing rows with workspaceId + read(team) — it resolves owner->workspace
 *      from the seat-0 row this script writes.
 *
 * Safety (ADR-0006 NFR-3 + appwrite-schema rules):
 *   - DRY-RUN BY DEFAULT. Set MIG_APPLY=1 to actually write.
 *   - Idempotent: deterministic ids (ws_default_<uid>, sub_/wq_/seat_0); a user
 *     who already belongs to ANY team is skipped; create-409 is treated as "exists".
 *   - Non-destructive: only creates Team/membership/sub/quota; never deletes or
 *     overwrites researcher data.
 *   - Reversible: all ids are deterministic and printed, so a workspace created
 *     here can be located and removed if a migration must be rolled back.
 *   - BACK UP FIRST: snapshot the Appwrite database/volumes before MIG_APPLY=1
 *     against production data.
 *
 * Usage:
 *   set -a && . ./.env && set +a && pnpm exec tsx scripts/migrate-default-workspaces.ts        # dry-run
 *   set -a && . ./.env && set +a && MIG_APPLY=1 pnpm exec tsx scripts/migrate-default-workspaces.ts
 */
import { Client, Databases, Teams, Users, Permission, Role, Query } from "node-appwrite";

const DB = "merism";
const APPLY = process.env.MIG_APPLY === "1";
const TRIAL_MS = 14 * 24 * 60 * 60 * 1000; // 14-day trial (prd-pricing.md)
const QUOTA_HARD_CEILING_MULTIPLE = 2; // mirror of @merism/contracts (not importable from a root script)
const DEFAULT_PLAN = "plus";

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT!)
  .setProject(process.env.APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
const db = new Databases(client);
const teams = new Teams(client);
const users = new Users(client);

const defaultWorkspaceId = (userId: string) => `ws_default_${userId}`.slice(0, 36);

function isConflict(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && (e as { code?: number }).code === 409);
}

/** Create a document, treating a 409 (already exists) as success (idempotent). */
async function createIdempotent(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  permissions: string[],
): Promise<void> {
  try {
    await db.createDocument(DB, collection, id, data, permissions);
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
}

async function planIncludedInterviews(): Promise<number> {
  try {
    const plan = await db.getDocument(DB, "plans", DEFAULT_PLAN);
    const inc = (plan as unknown as { includedInterviews?: number }).includedInterviews;
    return typeof inc === "number" ? inc : 0;
  } catch {
    return 0; // plans catalog not seeded -> 0 allowance until aggregator refreshes
  }
}

async function provisionDefaultWorkspace(
  userId: string,
  displayName: string,
  included: number,
): Promise<string> {
  const ws = defaultWorkspaceId(userId);
  const nowMs = Date.now();
  const teamRead = [Permission.read(Role.team(ws))];

  // 1. The workspace IS an Appwrite Team ($id === workspaceId).
  try {
    await teams.create(ws, `${displayName} Workspace`, ["owner"]);
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
  // 2. Owner membership (native Teams = the membership/role truth source).
  try {
    await teams.createMembership(ws, ["owner"], undefined, userId);
  } catch (e) {
    if (!isConflict(e)) throw e; // already a member
  }
  // 3. Owner seat-0 reservation row (what backfill reads to map owner->workspace).
  await createIdempotent(
    "workspace_memberships",
    `seat_${ws}_0`.slice(0, 36),
    { workspaceId: ws, userId, role: "owner", status: "active", createdAt: new Date(nowMs).toISOString() },
    teamRead,
  );
  // 4. Trial subscription (Plus, 1 seat).
  await createIdempotent(
    "subscriptions",
    `sub_${ws}`,
    {
      workspaceId: ws,
      planKey: DEFAULT_PLAN,
      status: "trialing",
      seats: 1,
      currentPeriodStart: new Date(nowMs).toISOString(),
      currentPeriodEnd: new Date(nowMs + TRIAL_MS).toISOString(),
    },
    teamRead,
  );
  // 5. Quota seeded from the plan allowance.
  await createIdempotent(
    "workspace_quota",
    `wq_${ws}`,
    {
      workspaceId: ws,
      periodEnd: new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
      usedInterviews: 0,
      includedInterviews: included,
      hardCeiling: included * QUOTA_HARD_CEILING_MULTIPLE,
      state: "ok",
    },
    teamRead,
  );
  return ws;
}

async function* allUsers(): AsyncGenerator<{ $id: string; name?: string; email?: string }> {
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await users.list(queries);
    for (const u of res.users) yield u as { $id: string; name?: string; email?: string };
    if (res.users.length < 100) break;
    cursor = res.users[res.users.length - 1].$id;
  }
}

async function main(): Promise<void> {
  console.log(`[mig] mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes; set MIG_APPLY=1 to apply)"}`);
  if (APPLY) console.log("[mig] reminder: back up the Appwrite database/volumes before applying to production.");

  const included = await planIncludedInterviews();
  let scanned = 0;
  let alreadyHasWorkspace = 0;
  let provisioned = 0;

  for await (const u of allUsers()) {
    scanned++;
    const memberships = await users.listMemberships(u.$id);
    if (memberships.total > 0) {
      alreadyHasWorkspace++;
      continue;
    }
    const displayName = (u.name || u.email || "My").trim();
    const ws = defaultWorkspaceId(u.$id);
    if (!APPLY) {
      console.log(`[mig] DRY-RUN would provision default workspace ${ws} for ${u.$id} (${displayName})`);
      provisioned++;
      continue;
    }
    const created = await provisionDefaultWorkspace(u.$id, displayName, included);
    console.log(`[mig] provisioned ${created} for ${u.$id} (${displayName})`);
    provisioned++;
  }

  console.log(
    `[mig] done: scanned=${scanned} alreadyHadWorkspace=${alreadyHasWorkspace} provisioned=${provisioned}`,
  );
  console.log(
    APPLY
      ? "[mig] next: run `pnpm exec tsx scripts/backfill-workspace-tenancy.ts` to tag existing rows with workspaceId + read(team)."
      : "[mig] dry-run only — re-run with MIG_APPLY=1 to provision, then run backfill-workspace-tenancy.ts.",
  );
}

main().catch((err) => {
  console.error("[mig] failed:", err);
  process.exit(1);
});
