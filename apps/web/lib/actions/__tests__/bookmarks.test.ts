import { describe, it, expect, vi, beforeEach } from "vitest";

const getDocument = vi.fn();
const updateDocument = vi.fn();
const createDocument = vi.fn();
const ownerMock = vi.fn();
const workspaceMock = vi.fn();

vi.mock("@/lib/queries/client", () => ({
  DATABASE_ID: "merism",
  getServerClient: () => ({ databases: { getDocument, updateDocument, createDocument } }),
}));
vi.mock("@/lib/auth/owner", () => ({
  requireOwnerUserId: () => ownerMock(),
  getOwnerUserIdOrNull: () => ownerMock(),
}));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceId: () => workspaceMock(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createBookmark, updateBookmark } from "@/lib/actions/bookmarks";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBookmark tenancy", () => {
  const input = {
    surveyId: "s_1",
    sessionId: "sess_1",
    quote: "关键反馈",
    source: "研究 · Q2",
    respondent: "受访者 · 01:23",
    segmentIndex: 2,
    startMs: 83000,
  };

  it("keys the bookmark on the study's workspace and shares it with the team", async () => {
    ownerMock.mockResolvedValue("u_author");
    getDocument.mockResolvedValueOnce({ ownerUserId: "u_author", workspaceId: "ws_1" }); // survey
    workspaceMock.mockResolvedValueOnce("ws_1"); // caller's workspace
    createDocument.mockResolvedValueOnce({});

    const res = await createBookmark(input);
    expect("id" in res).toBe(true);

    const [, , , payload, permissions] = createDocument.mock.calls[0];
    expect(payload).toMatchObject({
      ownerUserId: "u_author",
      authorId: "u_author",
      workspaceId: "ws_1",
      startMs: 83000,
      segmentIndex: 2,
    });
    expect(permissions).toContain('read("team:ws_1")');
    expect(permissions).not.toContain('read("user:u_author")');
  });

  it("lets a workspace teammate (not the study owner) add a bookmark", async () => {
    ownerMock.mockResolvedValue("u_teammate");
    getDocument.mockResolvedValueOnce({ ownerUserId: "u_other", workspaceId: "ws_1" });
    workspaceMock.mockResolvedValueOnce("ws_1"); // teammate is in the same workspace
    createDocument.mockResolvedValueOnce({});

    const res = await createBookmark(input);
    expect("id" in res).toBe(true);
    const [, , , payload] = createDocument.mock.calls[0];
    expect(payload).toMatchObject({ authorId: "u_teammate", workspaceId: "ws_1" });
  });

  it("denies a non-author who is not a member of the study's workspace", async () => {
    ownerMock.mockResolvedValue("stranger");
    getDocument.mockResolvedValueOnce({ ownerUserId: "u_other", workspaceId: "ws_1" });
    workspaceMock.mockResolvedValueOnce("ws_other");

    const res = await createBookmark(input);
    expect(res).toEqual({ error: "指定的调研不存在或不属于当前账户。" });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("falls back to owner-only permissions for a solo study (no workspace)", async () => {
    ownerMock.mockResolvedValue("u_solo");
    getDocument.mockResolvedValueOnce({ ownerUserId: "u_solo" }); // survey has no workspaceId
    workspaceMock.mockResolvedValueOnce(null);
    createDocument.mockResolvedValueOnce({});

    await createBookmark(input);

    const [, , , payload, permissions] = createDocument.mock.calls[0];
    expect(payload.workspaceId).toBeUndefined();
    expect(permissions).toContain('read("user:u_solo")');
    expect(permissions.some((p: string) => p.startsWith('read("team:'))).toBe(false);
  });
});

describe("updateBookmark", () => {
  it("rejects an empty id before any I/O", async () => {
    const res = await updateBookmark("  ", { note: "x" });
    expect(res).toEqual({ error: "无效的书签。" });
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    ownerMock.mockRejectedValueOnce(new Error("no session"));
    const res = await updateBookmark("bm_1", { note: "x" });
    expect(res).toEqual({ error: "请先登录。" });
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("maps a missing bookmark to a not-found error", async () => {
    ownerMock.mockResolvedValueOnce("u_1");
    getDocument.mockRejectedValueOnce({ code: 404 });
    const res = await updateBookmark("bm_1", { note: "x" });
    expect(res).toEqual({ error: "书签不存在。" });
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("refuses to update another owner's bookmark", async () => {
    ownerMock.mockResolvedValueOnce("u_1");
    getDocument.mockResolvedValueOnce({ ownerUserId: "someone_else" });
    const res = await updateBookmark("bm_1", { note: "x", tags: ["a"] });
    expect(res).toEqual({ error: "无权修改此书签。" });
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("normalizes note + tags and echoes them on success", async () => {
    ownerMock.mockResolvedValueOnce("u_1");
    getDocument.mockResolvedValueOnce({
      ownerUserId: "u_1",
      surveyId: "s_1",
      sessionId: "sess_1",
    });
    updateDocument.mockResolvedValueOnce({});

    const res = await updateBookmark("bm_1", {
      note: "  关键痛点  ",
      tags: ["导航", "导航", "", "  痛点  "],
    });

    expect(res).toEqual({ ok: true, note: "关键痛点", tags: ["导航", "痛点"] });
    expect(updateDocument).toHaveBeenCalledWith("merism", "bookmarks", "bm_1", {
      note: "关键痛点",
      tags: ["导航", "痛点"],
    });
  });

  it("is a no-op success when nothing is provided", async () => {
    ownerMock.mockResolvedValueOnce("u_1");
    getDocument.mockResolvedValueOnce({ ownerUserId: "u_1" });
    const res = await updateBookmark("bm_1", {});
    expect(res).toEqual({ ok: true });
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("does not swallow unexpected read failures", async () => {
    ownerMock.mockResolvedValueOnce("u_1");
    getDocument.mockRejectedValueOnce(new Error("network blip"));
    await expect(updateBookmark("bm_1", { note: "x" })).rejects.toThrow("network blip");
  });
});
