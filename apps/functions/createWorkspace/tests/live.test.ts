import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { Client, Teams, Databases } from "node-appwrite";
import { createWorkspace } from "../src/handler";
import { createRealDeps } from "../src/deps";

// Live integration (testing.md): gated by MERISM_LIVE_TESTS=1; needs the
// Appwrite Docker stack + schema:apply. Creates a real Team + docs, verifies,
// and cleans up. Skipped in the default test run.
const LIVE = process.env.MERISM_LIVE_TESTS === "1";

function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env */ }
}

describe.skipIf(!LIVE)("createWorkspace LIVE (ADR 0006)", () => {
  beforeAll(loadEnv);

  it("creates a real Team + owner membership + owner seat + trial sub + quota, then cleans up", async () => {
    const owner = process.env.MERISM_OWNER_USER_ID!;
    expect(owner, "MERISM_OWNER_USER_ID").toBeTruthy();
    const DB = "merism";
    const admin = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT!)
      .setProject(process.env.APPWRITE_PROJECT_ID!)
      .setKey(process.env.APPWRITE_API_KEY!);
    const teams = new Teams(admin);
    const db = new Databases(admin);

    const res = await createWorkspace({ name: `WB Live ${Date.now()}` }, createRealDeps(owner));
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const ws = res.body.workspaceId;
    try {
      const seat = (await db.getDocument(DB, "workspace_memberships", `seat_${ws}_0`)) as any;
      const sub = (await db.getDocument(DB, "subscriptions", `sub_${ws}`)) as any;
      const quota = (await db.getDocument(DB, "workspace_quota", `wq_${ws}`)) as any;
      const team = (await teams.get(ws)) as any;
      // eslint-disable-next-line no-console
      console.log("LIVE VERIFIED:", JSON.stringify({
        teamName: team.name, ownerSeatRole: seat.role,
        subStatus: sub.status, subSeats: sub.seats, subPlan: sub.planKey,
        quotaState: quota.state, quotaCeiling: quota.hardCeiling,
      }));
      expect(seat.role).toBe("owner");
      expect(sub.status).toBe("trialing");
      expect(sub.seats).toBe(1);
      expect(quota.state).toBe("ok");
      expect(res.body.planKey).toBe("plus");
    } finally {
      for (const id of [`seat_${ws}_0`])
        await db.deleteDocument(DB, "workspace_memberships", id).catch(() => {});
      await db.deleteDocument(DB, "subscriptions", `sub_${ws}`).catch(() => {});
      await db.deleteDocument(DB, "workspace_quota", `wq_${ws}`).catch(() => {});
      await teams.delete(ws).catch(() => {});
    }
  }, 60_000);
});
