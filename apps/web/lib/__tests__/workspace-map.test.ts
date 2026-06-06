import { describe, it, expect } from "vitest";
import type { InterviewSession } from "@merism/contracts";
import { sessionsToOverview } from "../workspace-map";

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
