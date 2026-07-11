import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { Client, Teams, Databases, Query } from "node-appwrite";
import { inviteMember } from "../src/handler";
import { createRealDeps as inviteDeps } from "../src/deps";
import { createWorkspace } from "../../createWorkspace/src/handler";
import { createRealDeps as wsDeps } from "../../createWorkspace/src/deps";

const LIVE = process.env.MERISM_LIVE_TESTS === "1";
function loadEnv() {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

describe.skipIf(!LIVE)("inviteMember LIVE (ADR 0006)", () => {
  beforeAll(loadEnv);

  it("enforces seat cap, then invites into a free seat (real Appwrite)", async () => {
    const owner = process.env.MERISM_OWNER_USER_ID!;
    const DB = "merism";
    const admin = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT!)
      .setProject(process.env.APPWRITE_PROJECT_ID!)
      .setKey(process.env.APPWRITE_API_KEY!);
    const teams = new Teams(admin);
    const db = new Databases(admin);

    const ws = await createWorkspace({ name: `Invite Live ${Date.now()}` }, wsDeps(owner));
    expect(ws.status).toBe(200);
    if (ws.status !== 200) return;
    const wsId = ws.body.workspaceId;

    try {
      // owner occupies seat 0, trial seats=1 -> next invite is over cap
      const full = await inviteMember({ workspaceId: wsId, email: "invitee1@merism.local", role: "member" }, inviteDeps(owner));
      console.log("LIVE invite@cap ->", JSON.stringify(full));
      expect(full.status).toBe(409);
      expect((full.body as any).error).toBe("seat_limit_reached");

      // bump seats, now an invite should land in seat 1
      await db.updateDocument(DB, "subscriptions", `sub_${wsId}`, { seats: 3 });
      const ok = await inviteMember({ workspaceId: wsId, email: "invitee1@merism.local", role: "member" }, inviteDeps(owner));
      console.log("LIVE invite ->", JSON.stringify(ok));
      expect(ok.status).toBe(200);

      // a non-member caller cannot invite
      const stranger = await inviteMember({ workspaceId: wsId, email: "x@merism.local", role: "member" }, inviteDeps("not-a-member-uid"));
      expect(stranger.status).toBe(403);
    } finally {
      const mems = await db.listDocuments(DB, "workspace_memberships", [Query.equal("workspaceId", wsId), Query.limit(100)]);
      for (const m of mems.documents) await db.deleteDocument(DB, "workspace_memberships", m.$id).catch(() => {});
      await db.deleteDocument(DB, "subscriptions", `sub_${wsId}`).catch(() => {});
      await db.deleteDocument(DB, "workspace_quota", `wq_${wsId}`).catch(() => {});
      await teams.delete(wsId).catch(() => {});
    }
  }, 90_000);
});
