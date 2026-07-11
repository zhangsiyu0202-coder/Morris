import { describe, it, expect } from "vitest";
import type { InterviewSession, Transcript } from "@merism/contracts";
import { sessionsToOverview, sessionsToResults, transcriptToDetail, sessionReportToSummary } from "../map";
import type { AnalysisReportOutput } from "@merism/contracts";

function session(over: Partial<InterviewSession>): InterviewSession {
  return {
    $id: "s",
    surveyId: "sv1",
    linkId: "l1",
    state: "completed",
    livekitRoom: "room",
    collectedAnswers: {},
    ...over,
  } as InterviewSession;
}

describe("sessionsToOverview", () => {
  it("counts totals/completed and maps + orders latest by startedAt desc", () => {
    const sessions = [
      session({ $id: "a", state: "completed", startedAt: "2024-11-11T18:23:00.000Z" }),
      session({ $id: "b", state: "in_progress", startedAt: "2024-11-11T19:46:00.000Z" }),
      session({ $id: "c", state: "failed", startedAt: "2024-11-11T17:58:00.000Z" }),
    ];
    const o = sessionsToOverview(sessions);

    expect(o.responsesTotal).toBe(3);
    expect(o.completedInterviews).toBe(1);
    expect(o.paused).toBe(false);
    // latest ordered by startedAt desc: b, a, c
    expect(o.latest.map((l) => l.sessionId)).toEqual(["b", "a", "c"]);
    expect(o.latest[0]).toMatchObject({ datetime: "2024-11-11 19:46", status: "in_progress" });
    expect(o.latest[1].status).toBe("completed");
    expect(o.latest[2].status).toBe("incomplete"); // failed -> incomplete
  });

  it("respects paused flag and limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      session({ $id: `s${i}`, startedAt: `2024-11-11T0${i}:00:00.000Z` }),
    );
    const o = sessionsToOverview(many, { paused: true, limit: 4 });
    expect(o.paused).toBe(true);
    expect(o.latest.length).toBe(4);
  });
});

describe("sessionsToResults", () => {
  it("builds question columns and aligns answers by questionId", () => {
    const questions = [
      { id: "q1", prompt: "常用的订房网站?" },
      { id: "q2", prompt: "最抓狂的事?" },
    ];
    const sessions = [
      session({
        $id: "a",
        state: "completed",
        startedAt: "2025-02-01T10:00:00.000Z",
        collectedAnswers: { q1: "Airbnb 和 Booking", q2: { text: "价格跳涨" } },
      }),
      session({ $id: "b", state: "in_progress", startedAt: "2025-02-01T11:00:00.000Z", collectedAnswers: {} }),
    ];
    const t = sessionsToResults(questions, sessions);

    expect(t.totalCount).toBe(2);
    expect(t.questionColumns.length).toBe(2);
    expect(t.questionColumns[0]).toContain("Q1");
    expect(t.rows[0].answers).toEqual(["Airbnb 和 Booking", "价格跳涨"]);
    expect(t.rows[0].summary).toBe("Airbnb 和 Booking");
    expect(t.rows[0].status).toBe("completed");
    expect(t.rows[1].answers).toEqual(["", ""]);
  });
});

describe("transcriptToDetail", () => {
  it("maps segments to turns and derives metadata", () => {
    const transcript: Transcript = {
      $id: "t1",
      sessionId: "a",
      segments: [
        { speaker: "interviewer", startMs: 0, endMs: 4000, text: "Q?" },
        { speaker: "respondent", startMs: 4000, endMs: 12000, text: "A." },
      ],
      language: "中文",
      finalizedAt: "2025-02-01T10:14:00.000Z",
    };
    const s = session({
      $id: "a",
      state: "completed",
      startedAt: "2025-02-01T10:00:00.000Z",
      endedAt: "2025-02-01T10:14:00.000Z",
    });
    const d = transcriptToDetail(transcript, s, "");

    expect(d.turns.map((x) => x.speaker)).toEqual(["interviewer", "respondent"]);
    expect(d.turns[1].text).toBe("A.");
    expect(d.aiSummary).toContain("暂无");
    const dur = d.metadata.find((m) => m.key === "duration");
    expect(dur?.value).toBe("14 分 0 秒");
  });
});

describe("sessionReportToSummary", () => {
  const base: AnalysisReportOutput = {
    scope: "session",
    themes: [
      {
        id: "t1",
        label: "Theme",
        description: "Theme description fallback",
        evidence: [{ transcriptId: "tr1", segmentIndex: 0 }],
      },
    ],
    insights: [
      { id: "i1", statement: "First insight", supportingThemes: ["t1"], confidence: 0.8 },
      { id: "i2", statement: "Second insight", supportingThemes: ["t1"], confidence: 0.7 },
    ],
    citations: [],
    perQuestionSummary: [{ questionId: "q1", summary: "Question summary", sentiment: "neutral" }],
    rendered: null,
  };

  it("prefers insight statements joined with semicolons", () => {
    expect(sessionReportToSummary(base)).toBe("First insight；Second insight");
  });

  it("falls back to perQuestionSummary when insights are empty", () => {
    expect(
      sessionReportToSummary({ ...base, insights: [], perQuestionSummary: base.perQuestionSummary }),
    ).toBe("Question summary");
  });

  it("falls back to first theme description when insights and summaries are empty", () => {
    expect(
      sessionReportToSummary({ ...base, insights: [], perQuestionSummary: [] }),
    ).toBe("Theme description fallback");
  });
});
