import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the queries + server-side notebook saver at module boundary; factory 实现
// 集中在 fixtures/install-mocks.ts. async + dynamic import 绕过 vitest hoisting.
vi.mock("@/lib/queries", async () => (await import("./fixtures/install-mocks")).fakeQueriesModule());
vi.mock("@/lib/server/notebooks", async () => (await import("./fixtures/install-mocks")).fakeNotebooksServerModule());

import * as queries from "@/lib/queries";
import * as serverNotebooks from "@/lib/server/notebooks";
import { buildCreateNotebookTool } from "../tools/create-notebook";

const mockGetStudy = vi.mocked(queries.getStudy);
const mockSave = vi.mocked(serverNotebooks.saveNotebookFromMarkdown);

beforeEach(() => {
  mockGetStudy.mockReset();
  mockSave.mockReset();
});

describe("Morris createNotebook tool", () => {
  it("returns 'not signed in' error when ownerUserId is null", async () => {
    const t = buildCreateNotebookTool({ ownerUserId: null });
    const result = await (t.spec as any).execute({
      studyId: "sv1",
      question: "Why?",
      content: "# Why?\n\nAnswer.",
    });
    expect(result).toMatchObject({ artifact: { error: true } });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("happy path: validates study, saves notebook, returns shortId in artifact", async () => {
    mockGetStudy.mockResolvedValue({
      $id: "sv1",
      survey: { title: "Pricing study", $id: "sv1" },
    } as any);
    mockSave.mockResolvedValue({ $id: "doc1", shortId: "abc123def456", sectionCount: 4 });

    const t = buildCreateNotebookTool({ ownerUserId: "user-1" });
    const result: any = await (t.spec as any).execute({
      studyId: "sv1",
      question: "Why high price sensitivity?",
      content:
        "# Why high price sensitivity?\n\n直接答案。\n\n## 核心结论\n...\n\n## 主题分析\n...\n\n## 立场分歧\n...\n\n## 行动建议\n...",
    });

    expect(mockGetStudy).toHaveBeenCalledWith({ ownerUserId: "user-1", workspaceId: null }, "sv1");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        studyId: "sv1",
        studyTitle: "Pricing study",
        question: "Why high price sensitivity?",
      }),
    );
    expect(result.artifact).toMatchObject({
      notebookShortId: "abc123def456",
      $id: "doc1",
      studyId: "sv1",
      sectionCount: 4,
      status: "created",
    });
    expect(result.content).toContain("abc123def456");
  });

  it("returns error envelope when study is not found / not owned", async () => {
    mockGetStudy.mockResolvedValue(null);
    const t = buildCreateNotebookTool({ ownerUserId: "user-1" });
    const result: any = await (t.spec as any).execute({
      studyId: "sv-missing",
      question: "Q?",
      content: "# Q?\n\nA.",
    });
    expect(result.artifact.error).toBe(true);
    expect(result.artifact.message).toContain("sv-missing");
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("draftContent path: does NOT call saveNotebookFromMarkdown, returns echo", async () => {
    const t = buildCreateNotebookTool({ ownerUserId: "user-1" });
    const result: any = await (t.spec as any).execute({
      studyId: "sv1",
      question: "Q?",
      draftContent: "# draft\n\n...",
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockGetStudy).not.toHaveBeenCalled();
    expect(result.artifact.notebookShortId).toBe("");
    expect(result.artifact.status).toBe("created");
    expect(result.content).toContain("草稿");
  });

  it("wraps server-side errors in envelope (does not throw out)", async () => {
    mockGetStudy.mockResolvedValue({
      $id: "sv1",
      survey: { title: "S", $id: "sv1" },
    } as any);
    mockSave.mockRejectedValue(new Error("appwrite_not_configured"));
    const t = buildCreateNotebookTool({ ownerUserId: "user-1" });
    const result: any = await (t.spec as any).execute({
      studyId: "sv1",
      question: "Q?",
      content: "# Q?\n\nA.",
    });
    expect(result.artifact.error).toBe(true);
    expect(result.content).toContain("appwrite_not_configured");
  });

  it("input schema rejects content + draftContent both set (mutex)", async () => {
    const t = buildCreateNotebookTool({ ownerUserId: "user-1" });
    // The Vercel AI SDK's tool() wrapper validates inputSchema at the LLM ↔
    // tool boundary in production. Here we directly assert the contract
    // schema's refine catches the mutex violation.
    const { CreateNotebookRequestSchema } = await import("@merism/contracts");
    const parsed = CreateNotebookRequestSchema.safeParse({
      studyId: "sv1",
      question: "Q?",
      content: "# x",
      draftContent: "# y",
    });
    expect(parsed.success).toBe(false);
  });
});
