import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the queries layer at the module boundary so the tool factory's static
// import resolves to spies. Each spy is reset before every test.
vi.mock("@/lib/queries", () => ({
  listStudies: vi.fn(),
  searchTranscriptSegments: vi.fn(),
  getLatestAnalysisReport: vi.fn(),
  parseSurveyReportBody: vi.fn(),
}));

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
    expect(result).toMatchObject({ error: true });
    expect(mockListStudies).not.toHaveBeenCalled();
  });

  it("searchInterviewData returns 'not signed in' error when ownerUserId is null", async () => {
    const tools = buildAssistantTools({ ownerUserId: null });
    const result = await (tools.searchInterviewData as any).execute({
      query: "x",
      studyId: "sv1",
    });
    expect(result).toMatchObject({ error: true });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("analyzeData returns 'not signed in' error when ownerUserId is null", async () => {
    const tools = buildAssistantTools({ ownerUserId: null });
    const result = await (tools.analyzeData as any).execute({ studyId: "sv1" });
    expect(result).toMatchObject({ error: true });
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
    expect(result.studies).toEqual([
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
    expect(result.count).toBe(1);
    expect(result.snippets[0]).toMatchObject({
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
    expect(result.error).toBe(true);
    expect(result.message).toContain("/reports/sv1");
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
      studyTitle: "Test",
      completedRespondents: 5,
    });
    expect(result.topThemes[0].label).toBe("Pricing");
    expect(result.topInsights[0].title).toBe("Top driver");
  });
});

describe("Morris tools factory: createStudyDraft (mock)", () => {
  it("returns a draft with the study disclaimer note", async () => {
    const tools = buildAssistantTools({ ownerUserId: "user-1" });
    const result: any = await (tools.createStudyDraft as any).execute({
      goal: "差旅住宿预订习惯",
      audience: "经常出差的上班族",
      questionCount: 5,
    });
    expect(result.title).toContain("差旅");
    expect(result.questions).toHaveLength(5);
    expect(result.note).toContain("survey-editor");
  });
});
