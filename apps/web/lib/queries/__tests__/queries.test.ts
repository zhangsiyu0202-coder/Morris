import { describe, it, expect } from "vitest";
import type { AnalysisReport } from "@merism/contracts";
import { listStudies, getStudy } from "../studies";
import { listSessions, countCompletedSessions } from "../sessions";
import { searchTranscriptSegments } from "../transcripts";
import { getLatestAnalysisReport, parseSessionReportBody } from "../reports";
import { listInsights, getInsightById } from "../notebooks";
import { listBookmarksForOwner, listBookmarksBySession } from "../bookmarks";
import { makeFakeDatabases } from "./helpers";

const owner = "user-owner";
const stranger = "user-other";

const survey = {
  $id: "sv1",
  projectId: "p1",
  title: "Test Study",
  status: "draft" as const,
  flowConfig: {},
  version: 1,
  ownerUserId: owner,
  updatedAt: "2026-06-06T00:00:00.000Z",
};

describe("queries: studies", () => {
  it("listStudies filters by ownerUserId", async () => {
    const { databases, calls } = makeFakeDatabases({
      surveys: { documents: [survey, { ...survey, $id: "sv2", ownerUserId: stranger }] },
    });
    const result = await listStudies(owner, databases);
    expect(result.map((s) => s.$id)).toEqual(["sv1"]);
    expect(calls[0]?.queries.some((q) => q.includes(owner))).toBe(true);
  });

  it("listStudies returns [] when collection is empty", async () => {
    const { databases } = makeFakeDatabases({ surveys: { documents: [] } });
    expect(await listStudies(owner, databases)).toEqual([]);
  });

  it("getStudy returns null when survey not owned by caller", async () => {
    const { databases } = makeFakeDatabases({
      surveys: { documents: [{ ...survey, ownerUserId: stranger }] },
      survey_sections: { documents: [] },
      question_blocks: { documents: [] },
    });
    expect(await getStudy(owner, "sv1", databases)).toBeNull();
  });

  it("getStudy returns survey + sections + questions when owned", async () => {
    const section = {
      $id: "sec1",
      surveyId: "sv1",
      title: "Sec",
      description: "",
      order: 0,
    };
    const question = {
      $id: "q1",
      surveyId: "sv1",
      sectionId: "sec1",
      order: 0,
      orderInSection: 0,
      type: "open_ended",
      prompt: "Tell me about it.",
      config: {},
      probingPolicy: {},
      skipLogic: {},
    };
    const { databases } = makeFakeDatabases({
      surveys: { documents: [survey] },
      survey_sections: { documents: [section] },
      question_blocks: { documents: [question] },
    });
    const result = await getStudy(owner, "sv1", databases);
    expect(result?.survey.$id).toBe("sv1");
    expect(result?.sections.map((s) => s.$id)).toEqual(["sec1"]);
    expect(result?.questions.map((q) => q.$id)).toEqual(["q1"]);
  });
});

describe("queries: sessions", () => {
  const session = {
    $id: "sess1",
    surveyId: "sv1",
    linkId: "lnk1",
    state: "completed" as const,
    livekitRoom: "room-1",
    collectedAnswers: {},
  };

  it("listSessions returns [] when survey not owned by caller", async () => {
    const { databases } = makeFakeDatabases({
      surveys: { documents: [{ ...survey, ownerUserId: stranger }] },
      interview_sessions: { documents: [session] },
    });
    expect(await listSessions(owner, "sv1", databases)).toEqual([]);
  });

  it("listSessions returns sessions for owned survey", async () => {
    const { databases } = makeFakeDatabases({
      surveys: { documents: [survey] },
      interview_sessions: { documents: [session] },
    });
    const result = await listSessions(owner, "sv1", databases);
    expect(result.map((s) => s.$id)).toEqual(["sess1"]);
  });

  it("countCompletedSessions counts only completed", async () => {
    const { databases } = makeFakeDatabases({
      surveys: { documents: [survey] },
      interview_sessions: {
        documents: [
          session,
          { ...session, $id: "sess2", state: "in_progress" },
          { ...session, $id: "sess3", state: "completed" },
        ],
      },
    });
    expect(await countCompletedSessions(owner, "sv1", databases)).toBe(2);
  });
});

describe("queries: transcripts", () => {
  it("returns [] when surveyId is omitted (forbidden cross-survey scan)", async () => {
    const { databases } = makeFakeDatabases({});
    expect(await searchTranscriptSegments(owner, { query: "foo" }, databases)).toEqual([]);
  });

  it("matches by case-insensitive substring across stored transcripts", async () => {
    const session = {
      $id: "sess1",
      surveyId: "sv1",
      linkId: "lnk1",
      state: "completed" as const,
      livekitRoom: "room-1",
      collectedAnswers: {},
    };
    const transcript = {
      $id: "t1",
      sessionId: "sess1",
      segments: JSON.stringify([
        { speaker: "interviewee", startMs: 0, endMs: 1000, text: "I love Airbnb" },
        { speaker: "interviewee", startMs: 1000, endMs: 2000, text: "Hotels are fine" },
      ]),
      language: "zh",
      finalizedAt: "2026-06-06T00:00:00.000Z",
    };
    const { databases } = makeFakeDatabases({
      surveys: { documents: [survey] },
      interview_sessions: { documents: [session] },
      transcripts: { documents: [transcript] },
    });
    const hits = await searchTranscriptSegments(
      owner,
      { query: "AIRBNB", surveyId: "sv1" },
      databases,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.text).toBe("I love Airbnb");
    expect(hits[0]?.transcriptId).toBe("t1");
    expect(hits[0]?.segmentIndex).toBe(0);
  });
});

describe("queries: reports", () => {
  it("returns null when no report exists", async () => {
    const { databases } = makeFakeDatabases({ analysis_reports: { documents: [] } });
    const result = await getLatestAnalysisReport(
      owner,
      { surveyId: "sv1", scope: "survey" },
      databases,
    );
    expect(result).toBeNull();
  });

  it("returns the report when ownerUserId matches", async () => {
    const reportRow = {
      $id: "ar1",
      surveyId: "sv1",
      scope: "survey",
      ownerUserId: owner,
      themes: "[]",
      insights: "[]",
      citations: "[]",
      generatedAt: "2026-06-06T00:00:00.000Z",
    };
    const { databases } = makeFakeDatabases({
      analysis_reports: { documents: [reportRow] },
    });
    const result = await getLatestAnalysisReport(
      owner,
      { surveyId: "sv1", scope: "survey" },
      databases,
    );
    expect(result?.$id).toBe("ar1");
    expect(result?.scope).toBe("survey");
  });

  it("filters out reports owned by another researcher", async () => {
    const reportRow = {
      $id: "ar1",
      surveyId: "sv1",
      scope: "survey",
      ownerUserId: stranger,
      themes: "[]",
      insights: "[]",
      citations: "[]",
      generatedAt: "2026-06-06T00:00:00.000Z",
    };
    const { databases } = makeFakeDatabases({
      analysis_reports: { documents: [reportRow] },
    });
    const result = await getLatestAnalysisReport(
      owner,
      { surveyId: "sv1", scope: "survey" },
      databases,
    );
    expect(result).toBeNull();
  });

  it("requires sessionId for scope=session", async () => {
    const { databases } = makeFakeDatabases({ analysis_reports: { documents: [] } });
    await expect(() =>
      getLatestAnalysisReport(owner, { surveyId: "sv1", scope: "session" }, databases),
    ).rejects.toThrow(/sessionId is required/);
  });

  it("parseSessionReportBody rehydrates analyzeSession upsert shape", () => {
    const bodyFixture = {
      scope: "session" as const,
      themes: [
        {
          id: "t1",
          label: "Price",
          description: "Price sensitivity theme",
          evidence: [{ transcriptId: "tr1", segmentIndex: 0 }],
        },
      ],
      insights: [
        {
          id: "i1",
          statement: "Users care about price",
          supportingThemes: ["t1"],
          confidence: 0.9,
        },
      ],
      citations: [
        {
          segmentRef: { transcriptId: "tr1", segmentIndex: 0 },
          quote: "too expensive",
          themeIds: ["t1"],
        },
      ],
      perQuestionSummary: [
        { questionId: "q1", summary: "Price is the main concern", sentiment: "negative" },
      ],
      rendered: null,
      visualAnalysis: null,
    };

    const report = {
      $id: "ar_sess",
      sessionId: "sess1",
      surveyId: "sv1",
      scope: "session" as const,
      themes: bodyFixture.themes,
      insights: {
        insights: bodyFixture.insights,
        perQuestionSummary: bodyFixture.perQuestionSummary,
        visualAnalysis: bodyFixture.visualAnalysis,
      },
      citations: bodyFixture.citations,
      generatedAt: "2026-06-06T00:00:00.000Z",
    } as unknown as AnalysisReport;

    const parsed = parseSessionReportBody(report);
    expect(parsed).toEqual(bodyFixture);
  });

  it("parseSessionReportBody returns null for survey scope", () => {
    const report = {
      $id: "ar1",
      surveyId: "sv1",
      scope: "survey" as const,
      ownerUserId: owner,
      themes: [],
      insights: [],
      citations: [],
      generatedAt: "2026-06-06T00:00:00.000Z",
    };
    expect(parseSessionReportBody(report)).toBeNull();
  });
});

describe("queries: notebooks", () => {
  const insightDoc = {
    $id: "i1",
    studyId: "sv1",
    studyTitle: "Test",
    question: "Why?",
    headline: "Because of pricing",
    summary: "It is the price.",
    confidence: "high" as const,
    sampleSize: 12,
    ownerUserId: owner,
    createdAt: "2026-06-06T00:00:00.000Z",
    report: JSON.stringify({
      headline: "Because of pricing",
      directAnswer: "Pricing.",
      confidence: "high",
      confidenceReason: "12/15 quotes",
      themes: [{ title: "Price", analysis: "...", quotes: ["..."] }],
      divergences: [{ group: "g1", stance: "s1" }],
      actions: [{ priority: "P0", action: "act", rationale: "r" }],
    }),
  };

  it("listInsights returns owner's insights only", async () => {
    const { databases } = makeFakeDatabases({
      notebooks: {
        documents: [insightDoc, { ...insightDoc, $id: "i2", ownerUserId: stranger }],
      },
    });
    const result = await listInsights(owner, databases);
    expect(result.map((r) => r.$id)).toEqual(["i1"]);
  });

  it("getInsightById returns null for unowned id", async () => {
    const { databases } = makeFakeDatabases({
      notebooks: { documents: [{ ...insightDoc, ownerUserId: stranger }] },
    });
    expect(await getInsightById(owner, "i1", databases)).toBeNull();
  });

  it("getInsightById returns the insight when owned", async () => {
    const { databases } = makeFakeDatabases({
      notebooks: { documents: [insightDoc] },
    });
    const result = await getInsightById(owner, "i1", databases);
    expect(result?.headline).toBe("Because of pricing");
    expect(result?.report.actions[0]?.priority).toBe("P0");
  });
});

describe("queries: bookmarks", () => {
  const bookmarkDoc = {
    $id: "bm1",
    ownerUserId: owner,
    surveyId: "sv1",
    sessionId: "sess1",
    quote: "A memorable quote.",
    source: "Study · Q1",
    respondent: "受访者 · 01:23",
    segmentIndex: 2,
    createdAt: "2026-06-06T00:00:00.000Z",
  };

  it("listBookmarksForOwner filters by ownerUserId", async () => {
    const { databases } = makeFakeDatabases({
      bookmarks: {
        documents: [bookmarkDoc, { ...bookmarkDoc, $id: "bm2", ownerUserId: stranger }],
      },
    });
    const result = await listBookmarksForOwner(owner, 10, databases);
    expect(result.map((b) => b.$id)).toEqual(["bm1"]);
    expect(result[0]?.quote).toBe("A memorable quote.");
  });

  it("listBookmarksBySession scopes to owner and session", async () => {
    const { databases } = makeFakeDatabases({
      bookmarks: {
        documents: [
          bookmarkDoc,
          { ...bookmarkDoc, $id: "bm3", sessionId: "sess2" },
          { ...bookmarkDoc, $id: "bm4", ownerUserId: stranger },
        ],
      },
    });
    const result = await listBookmarksBySession(owner, "sess1", databases);
    expect(result.map((b) => b.$id)).toEqual(["bm1"]);
  });
});
