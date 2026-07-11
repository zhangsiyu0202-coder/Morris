/**
 * Seed a dev workspace for the local owner so the ADR-0006 shared-review path
 * is exercisable: creates an Appwrite Team (the workspace) and an *active*
 * workspace_memberships row for MERISM_OWNER_USER_ID. Idempotent (deterministic
 * ids; 409s are treated as "already there"). Local/dev only.
 *
 * After running, re-run scripts/backfill-workspace-tenancy.ts to tag existing
 * studies/bookmarks with this workspace.
 *
 * Usage:
 *   set -a && . ./.env && set +a && pnpm exec tsx scripts/seed-workspace.ts
 */
import { Client, Databases, Teams, Permission, Role } from "node-appwrite";

const DB = "merism";
const OWNER = process.env.MERISM_OWNER_USER_ID;
if (!OWNER) {
  console.error("[seed-workspace] MERISM_OWNER_USER_ID is required");
  process.exit(1);
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT!)
  .setProject(process.env.APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
const db = new Databases(client);
const teams = new Teams(client);

// Deterministic, re-runnable id (Appwrite team id: <=36 chars, [a-zA-Z0-9._-]).
const WS = `ws_dev_${OWNER}`.slice(0, 36);

function isConflict(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && (e as { code?: number }).code === 409);
}

async function main(): Promise<void> {
  // 1. The workspace IS an Appwrite Team ($id === workspaceId).
  try {
    await teams.create(WS, "Dev Workspace", ["owner"]);
    console.log(`[seed-workspace] created team ${WS}`);
  } catch (e) {
    if (!isConflict(e)) throw e;
    console.log(`[seed-workspace] team ${WS} already exists`);
  }

  // 2. Add the owner to the Team (best-effort: the membership row below is what
  //    the resolver/backfill read; Team membership matters only for client-SDK
  //    reads, which the server-rendered review surface does not use).
  try {
    await teams.createMembership(WS, ["owner"], undefined, OWNER);
    console.log(`[seed-workspace] added ${OWNER} to team ${WS}`);
  } catch (e) {
    if (!isConflict(e)) console.warn(`[seed-workspace] team membership skipped: ${String(e)}`);
  }

  // 3. Denormalized active membership row (what getCurrentWorkspaceId reads).
  const seatId = `seat_${WS}_0`.slice(0, 36);
  try {
    await db.createDocument(
      DB,
      "workspace_memberships",
      seatId,
      {
        workspaceId: WS,
        userId: OWNER,
        role: "owner",
        status: "active",
        createdAt: new Date().toISOString(),
      },
      [Permission.read(Role.team(WS))],
    );
    console.log(`[seed-workspace] created active membership ${seatId}`);
  } catch (e) {
    if (!isConflict(e)) throw e;
    console.log(`[seed-workspace] membership ${seatId} already exists`);
  }

  console.log(`[seed-workspace] done. workspaceId=${WS}`);
}

main().catch((err) => {
  console.error("[seed-workspace] failed:", err);
  process.exit(1);
});
