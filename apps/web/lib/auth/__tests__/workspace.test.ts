import { describe, it, expect, vi, beforeEach } from "vitest";

const listDocuments = vi.fn();

vi.mock("@/lib/queries/client", () => ({
  DATABASE_ID: "merism",
  getServerClient: () => ({ databases: { listDocuments } }),
  Query: {
    equal: (k: string, v: unknown) => ({ k, v }),
    limit: (n: number) => ({ limit: n }),
  },
}));
vi.mock("@/lib/queries/auth", () => ({ getCurrentUserId: vi.fn() }));

import { getWorkspaceIdForUser } from "@/lib/auth/workspace";

beforeEach(() => vi.clearAllMocks());

describe("getWorkspaceIdForUser", () => {
  it("returns the workspaceId of the user's active membership", async () => {
    listDocuments.mockResolvedValueOnce({
      documents: [{ workspaceId: "ws_1", userId: "u_1", status: "active" }],
    });
    expect(await getWorkspaceIdForUser("u_1")).toBe("ws_1");
  });

  it("returns null when the user has no active membership", async () => {
    listDocuments.mockResolvedValueOnce({ documents: [] });
    expect(await getWorkspaceIdForUser("u_1")).toBeNull();
  });
});
