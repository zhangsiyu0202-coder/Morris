import { describe, it, expect, vi, beforeEach } from "vitest";

const teamsList = vi.fn();

// Minimal node-appwrite mock: Teams (the SUT path) + the symbols client.ts
// touches at module load. None of these run real I/O.
vi.mock("node-appwrite", () => ({
  Teams: vi.fn().mockImplementation(() => ({ list: teamsList })),
  Client: class {
    setEndpoint() {
      return this;
    }
    setProject() {
      return this;
    }
    setKey() {
      return this;
    }
    setSession() {
      return this;
    }
  },
  Databases: class {},
  Query: { equal: (k: string, v: unknown) => `equal(${k},${JSON.stringify(v)})` },
}));
vi.mock("@/lib/auth/appwrite", () => ({
  readSessionSecret: vi.fn(),
  sessionClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/queries/auth", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentWorkspaceId } from "@/lib/auth/workspace";
import { readSessionSecret } from "@/lib/auth/appwrite";

const mockSecret = vi.mocked(readSessionSecret);

beforeEach(() => vi.clearAllMocks());

describe("getCurrentWorkspaceId (native Appwrite Teams)", () => {
  it("returns the first team the researcher belongs to", async () => {
    mockSecret.mockResolvedValue("sess_secret");
    teamsList.mockResolvedValue({ teams: [{ $id: "ws_1" }, { $id: "ws_2" }], total: 2 });
    expect(await getCurrentWorkspaceId()).toBe("ws_1");
  });

  it("returns null when the researcher belongs to no team (solo fallback)", async () => {
    mockSecret.mockResolvedValue("sess_secret");
    teamsList.mockResolvedValue({ teams: [], total: 0 });
    expect(await getCurrentWorkspaceId()).toBeNull();
  });

  it("returns null when signed out (no session secret)", async () => {
    mockSecret.mockResolvedValue(null);
    expect(await getCurrentWorkspaceId()).toBeNull();
    expect(teamsList).not.toHaveBeenCalled();
  });

  it("falls back to null when the Teams API throws", async () => {
    mockSecret.mockResolvedValue("sess_secret");
    teamsList.mockRejectedValue(new Error("appwrite_unreachable"));
    expect(await getCurrentWorkspaceId()).toBeNull();
  });
});
