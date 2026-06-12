import { describe, it, expect } from "vitest";
import type { AnalysisReport } from "@merism/contracts";
import { listStudies, getStudy, getStudyForViewer } from "../studies";
import { listSessions, countCompletedSessions } from "../sessions";
import { searchTranscriptSegments } from "../transcripts";
import { getLatestAnalysisReport, parseSessionReportBody } from "../reports";
import { listNotebooks, getNotebookById } from "../notebooks";
import { listBookmarksForTenant, listBookmarksBySession } from "../bookmarks";
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
  it("listStudies returns the surveys the session client yields", async () => {
    // The session client already enforces tenant isolation (Role.user/Role.team);
    // the fake returns the caller's readable set, which the function parses through.
    const { databases } = makeFakeDatabases({
      surveys: { documents: [survey] },
    });
    const result = await listStudies(databases);
    expect(result.map((s) => s.$id)).toEqual(["sv1"]);
  });

  it("listStudies returns [] when collection is empty", async () => {
    const { databases } = makeFakeDatabases({ surveys: { documents: [] } });
    expect(await listStudies(databases)).toEqual([]);
  });

  it("getStudy returns null when the session client cannot read the survey", async () => {
    // An unreadable survey is simply absent from the session client's result.
    const { databases } = makeFakeDatabases({
      surveys: { documents: [] },
      survey_sections: { documents: [] },
      question_blocks: { documents: [] },
    });
    expect(await getStudy("sv1", databases)).toBeNull();
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
    const result = await getStudy("sv1", databases);
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

  it("listSessions returns [] when the session client cannot read the survey", async () => {
    const { databases } = makeFakeDatabases({
      surveys: { documents: [] },
      interview_sessions: { documents: [session] },
    });
    expect(await listSessions("sv1", databases)).toEqual([]);
  });

  it("listSessions returns sessions for owned survey", async () => {
    const { databases } = makeFakeDatabases({
      surveys: { documents: [survey] },
      interview_sessions: { documents: [session] },
    });
    const result = await listSessions("sv1", databases);
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
    expect(await countCompletedSessions("sv1", databases)).toBe(2);
  });
});

describe("queries: transcripts", () => {
  it("returns [] when surveyId is omitted (forbidden cross-survey scan)", async () => {
    const { databases } = makeFakeDatabases({});
    expect(await searchTranscriptSegments({ query: "foo" }, databases)).toEqual([]);
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

  it("listNotebooks returns the notebooks the session client yields", async () => {
    const { databases } = makeFakeDatabases({
      notebooks: { documents: [insightDoc] },
    });
    const result = await listNotebooks(databases);
    expect(result.map((r) => r.$id)).toEqual(["i1"]);
  });

  it("getNotebookById returns null when the session client cannot read it", async () => {
    const { databases } = makeFakeDatabases({
      notebooks: { documents: [] },
    });
    expect(await getNotebookById("i1", databases)).toBeNull();
  });

  it("getNotebookById returns the insight when owned", async () => {
    const { databases } = makeFakeDatabases({
      notebooks: { documents: [insightDoc] },
    });
    const result = await getNotebookById("i1", databases);
    expect(result?.headline).toBe("Because of pricing");
    // Wave F (T48): legacy `report` field removed — assert headline only.
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

  it("listBookmarksForTenant returns the bookmarks the session client yields", async () => {
    const { databases } = makeFakeDatabases({
      bookmarks: { documents: [bookmarkDoc] },
    });
    const result = await listBookmarksForTenant(10, databases);
    expect(result.map((b) => b.$id)).toEqual(["bm1"]);
    expect(result[0]?.quote).toBe("A memorable quote.");
  });

  it("listBookmarksBySession filters the readable set by sessionId", async () => {
    const { databases } = makeFakeDatabases({
      bookmarks: {
        documents: [bookmarkDoc, { ...bookmarkDoc, $id: "bm3", sessionId: "sess2" }],
      },
    });
    const result = await listBookmarksBySession("sess1", databases);
    expect(result.map((b) => b.$id)).toEqual(["bm1"]);
  });

  it("listBookmarksBySession returns the whole readable set for the session", async () => {
    // The session client yields the team's annotations (Role.team) for a member;
    // we only filter by sessionId here.
    const { databases } = makeFakeDatabases({
      bookmarks: {
        documents: [
          { ...bookmarkDoc, workspaceId: "ws_1" },
          { ...bookmarkDoc, $id: "bm5", ownerUserId: stranger, workspaceId: "ws_1" },
        ],
      },
    });
    const result = await listBookmarksBySession("sess1", databases);
    expect(result.map((b) => b.$id).sort()).toEqual(["bm1", "bm5"]);
  });
});

describe("queries: getStudyForViewer (session-client gate)", () => {
  const wsSurvey = { ...survey, $id: "sv_ws", workspaceId: "ws_1" };
  const empty = { survey_sections: { documents: [] }, question_blocks: { documents: [] } };

  it("returns the study + effective owner when the session client can read it", async () => {
    // Authorization is Appwrite's: if the session client returns the survey, the
    // caller may read it (author or workspace team). Cross-tenant isolation is
    // verified end-to-end against the live stack, not here.
    const { databases } = makeFakeDatabases({ surveys: { documents: [wsSurvey] }, ...empty });
    const r = await getStudyForViewer("sv_ws", databases);
    expect(r).not.toBeNull();
    expect(r?.ownerUserId).toBe(owner);
  });

  it("returns null when the session client cannot read the study", async () => {
    const { databases } = makeFakeDatabases({ surveys: { documents: [] }, ...empty });
    expect(await getStudyForViewer("sv_ws", databases)).toBeNull();
  });
});
