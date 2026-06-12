import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only deps at module boundary so tool factories' static imports
// resolve to spies. factory 实现集中在 fixtures/install-mocks.ts. async + dynamic
// import 绕过 vitest hoisting (testing.md::Test double pattern).
vi.mock("@/lib/queries", async () => (await import("./fixtures/install-mocks")).fakeQueriesModule());
vi.mock("@/lib/server/notebooks", async () => (await import("./fixtures/install-mocks")).fakeNotebooksServerModule());
vi.mock("@/lib/server/embedder-qwen", async () => (await import("./fixtures/install-mocks")).fakeEmbedderQwenModule());
vi.mock("node-appwrite", async () => (await import("./fixtures/install-mocks")).fakeNodeAppwriteModule());

import * as queries from "@/lib/queries";
import { buildAssistantTools } from "../tools";

const mockListStudies = vi.mocked(queries.listStudies);
const mockSearch = vi.mocked(queries.searchTranscriptSegments);
const mockLatestReport = vi.mocked(queries.getLatestAnalysisReport);
const mockParseBody = vi.mocked(queries.parseSurveyReportBody);

beforeEach(() => {
  mockListStudies.mockReset();
  mockSearch.mockReset();
  mockLatestReport.mockReset();
  mockParseBody.mockReset();
});

describe("Morris tools factory: not-signed-in short circuit", () => {
  it("listStudies returns 'not signed in' error when ownerUserId is null", async () => {
    const tools = buildAssistantTools({ ownerUserId: null });
    const result = await (tools.listStudies as any).execute({});
    expect(result).toMatchObject({ artifact: { error: true } });
    expect(mockListStudies).not.toHaveBeenCalled();
  });

  it("searchInterviewData returns 'not signed in' error when ownerUserId is null", async () => {
    const tools = buildAssistantTools({ ownerUserId: null });
    const result = await (tools.searchInterviewData as any).execute({
      query: "x",
      studyId: "sv1",
    });
    expect(result).toMatchObject({ artifact: { error: true } });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("analyzeData returns 'not signed in' error when ownerUserId is null", async () => {
    const tools = buildAssistantTools({ ownerUserId: null });
    const result = await (tools.analyzeData as any).execute({ studyId: "sv1" });
    expect(result).toMatchObject({ artifact: { error: true } });
    expect(mockLatestReport).not.toHaveBeenCalled();
  });
});

describe("Morris tools factory: signed-in path", () => {
  it("listStudies forwards ownerUserId and shapes the tool output", async () => {
    mockListStudies.mockResolvedValue([
      {
        $id: "sv1",
        projectId: "p1",
        title: "Test",
        status: "draft",
        flowConfig: {},
        version: 1,
        updatedAt: "2026-06-06T00:00:00.000Z",
      } as any,
    ]);
    const tools = buildAssistantTools({ ownerUserId: "user-1" });
    const result: any = await (tools.listStudies as any).execute({});
    expect(mockListStudies).toHaveBeenCalledWith("user-1");
    expect(result.content).toContain("已读取 1 个调研");
    expect(result.artifact.studies).toEqual([
      {
        id: "sv1",
        title: "Test",
        status: "draft",
        version: 1,
        updatedAt: "2026-06-06T00:00:00.000Z",
      },
    ]);
  });

  it("searchInterviewData forwards ownerUserId and reshapes hits", async () => {
    mockSearch.mockResolvedValue([
      {
        ownerUserId: "user-1",
        sessionId: "sess1",
        transcriptId: "t1",
        segmentIndex: 0,
        speaker: "interviewee",
        text: "Hello",
        startMs: 0,
        endMs: 1000,
      },
    ]);
    const tools = buildAssistantTools({ ownerUserId: "user-1" });
    const result: any = await (tools.searchInterviewData as any).execute({
      query: "hello",
      studyId: "sv1",
    });
    expect(mockSearch).toHaveBeenCalledWith("user-1", {
      query: "hello",
      surveyId: "sv1",
      limit: 20,
    });
    expect(result.content).toContain("检索到 1 条访谈片段");
    expect(result.artifact.count).toBe(1);
    expect(result.artifact.snippets[0]).toMatchObject({
      sessionId: "sess1",
      transcriptId: "t1",
      segmentIndex: 0,
      text: "Hello",
    });
  });

  it("analyzeData returns 'no report yet' when storage is empty", async () => {
    mockLatestReport.mockResolvedValue(null);
    const tools = buildAssistantTools({ ownerUserId: "user-1" });
    const result: any = await (tools.analyzeData as any).execute({ studyId: "sv1" });
    expect(result.artifact.error).toBe(true);
    expect(result.artifact.message).toContain("/reports/sv1");
    expect(mockParseBody).not.toHaveBeenCalled();
  });

  it("analyzeData returns top themes/insights when a report exists", async () => {
    mockLatestReport.mockResolvedValue({
      $id: "ar1",
      surveyId: "sv1",
      scope: "survey",
      generatedAt: "2026-06-06T00:00:00.000Z",
      themes: [],
      insights: [],
      citations: [],
    } as any);
    mockParseBody.mockReturnValue({
      surveyId: "sv1",
      surveyTitle: "Test",
      totalRespondents: 5,
      completedRespondents: 5,
      avgDurationLabel: "10:00",
      lastUpdatedLabel: "now",
      topics: [],
      questionStats: [],
      sentimentBreakdown: [],
      themes: [
        { id: "t1", label: "Pricing", mentions: 3, pct: 60, sentiment: "negative" },
      ],
      insights: [{ id: "i1", title: "Top driver", text: "...", confidence: 0.7 }],
      citations: [],
      rendered: null,
    });
    const tools = buildAssistantTools({ ownerUserId: "user-1" });
    const result: any = await (tools.analyzeData as any).execute({ studyId: "sv1" });
    expect(result).toMatchObject({
      content: expect.stringContaining("Test"),
      artifact: {
        studyTitle: "Test",
        completedRespondents: 5,
      },
    });
    expect(result.artifact.topThemes[0].label).toBe("Pricing");
    expect(result.artifact.topInsights[0].title).toBe("Top driver");
  });
});

describe("Morris tools factory: createStudyDraft", () => {
  it("anonymous → preview artifact (no Appwrite write)", async () => {
    const tools = buildAssistantTools({ ownerUserId: null });
    const result: any = await (tools.createStudyDraft as any).execute({
      title: "差旅住宿预订习惯",
      researchGoal: "了解差旅住宿预订习惯",
      targetAudience: "经常出差的上班族",
      introScript: "你好,感谢参与这次访谈。",
      sections: [
        {
          title: "预订渠道",
          objective: "了解渠道选择",
          questions: [{ questionText: "你通常怎么订住宿?", questionType: "open_ended" }],
        },
      ],
    });
    expect(result.content).toContain("草稿预览");
    expect(result.artifact).toMatchObject({ persisted: false });
    expect(result.artifact.draft.title).toContain("差旅");
  });
});
