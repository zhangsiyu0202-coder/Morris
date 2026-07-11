import { describe, it, expect, vi } from "vitest";
import { issueLivekitToken, type IssueDeps, type LinkRecord } from "../src/handler";

const link: LinkRecord = {
  $id: "l1",
  surveyId: "sv1",
  ownerUserId: "u1",
  workspaceId: "ws_1",
  mode: "reusable",
  kind: "production",
  maxUses: 5,
  usedCount: 0,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  isRevoked: false,
  surveyStatus: "published",
};

function deps(over: Partial<IssueDeps> = {}): IssueDeps {
  return {
    livekitUrl: "wss://lk",
    now: () => Date.now(),
    findLink: vi.fn(async () => link),
    createSession: vi.fn(async () => true),
    deleteSession: vi.fn(async () => {}),
    listOrphanSessions: vi.fn(async () => []),
    setUsedCount: vi.fn(async () => {}),
    getSurveyMeta: vi.fn(async () => ({ surveyId: "sv1", title: "T" })),
    createRoom: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    signToken: vi.fn(async () => "jwt"),
    ...over,
  };
}

describe("issueLivekitToken — workspace quota gate (ADR 0006 M6)", () => {
  it("blocks a new interview with 402 when the workspace is over quota", async () => {
    const d = deps({ checkQuota: vi.fn(async () => "over") });
    const r = await issueLivekitToken({ linkToken: "tok" }, d);
    expect(r.status).toBe(402);
    expect(r.body).toEqual({ error: "quota_exceeded" });
    expect(d.createSession).not.toHaveBeenCalled();
  });

  it("proceeds when within quota", async () => {
    const r = await issueLivekitToken({ linkToken: "tok" }, deps({ checkQuota: vi.fn(async () => "ok") }));
    expect(r.status).toBe(200);
  });

  it("proceeds when no quota checker is wired (back-compat)", async () => {
    const r = await issueLivekitToken({ linkToken: "tok" }, deps());
    expect(r.status).toBe(200);
  });
});
