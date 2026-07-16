// Property tests for the pure `finalizeInterviewSession` handler, ported
// per ADR-0013 § Migration completeness bar §8 from the deleted Python
// `apps/agent/tests/test_supervisor_finalize.py`. The core invariants:
//
//   1. Idempotent on already-terminal sessions — a retry after the first
//      successful finalize does not double-write the transcript, does not
//      re-emit the usage_event, and does not re-trigger analysis.
//   2. Session-not-found returns 404 without side effects.
//   3. Survey mismatch returns 400 without side effects.
//   4. `terminalStatus="completed"` on a non-terminal session emits exactly
//      one usage_event and triggers analysis once.
//   5. `terminalStatus="abandoned"` on a non-terminal session updates state
//      but does NOT emit usage_event / trigger analysis.
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  finalizeInterviewSession,
  type FinalizeDeps,
  type SessionRecord,
} from "../src/handler";

type Emitted =
  | { kind: "update"; args: unknown }
  | {
      kind: "transcript";
      sessionId: string;
      body: { segments: Array<{ speaker: string; startMs: number; endMs: number; text: string }>; language: string };
    }
  | { kind: "usage"; sessionId: string }
  | { kind: "analysis"; sessionId: string };

interface FakeStore {
  session: SessionRecord | null;
  emitted: Emitted[];
  usageEmittedFor: Set<string>;
}

function makeDeps(store: FakeStore, opts: { nowMs?: number } = {}): FinalizeDeps {
  return {
    now: () => opts.nowMs ?? 1_700_000_000_000,
    async getSession(_id) {
      return store.session;
    },
    async updateSession(id, fields) {
      if (!store.session) throw new Error("no session");
      store.session = { ...store.session, state: fields.state };
      store.emitted.push({ kind: "update", args: { id, ...fields } });
    },
    async upsertTranscript(sessionId, body) {
      store.emitted.push({ kind: "transcript", sessionId, body });
    },
    async emitUsageEvent(args) {
      if (store.usageEmittedFor.has(args.sessionId)) {
        // simulate Appwrite unique-id 409: emit noop, do not push another row
        return;
      }
      store.usageEmittedFor.add(args.sessionId);
      store.emitted.push({ kind: "usage", sessionId: args.sessionId });
    },
    async triggerAnalysis(args) {
      store.emitted.push({ kind: "analysis", sessionId: args.sessionId });
    },
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    $id: "s-1",
    surveyId: "srv-1",
    ownerUserId: "u-1",
    workspaceId: null,
    state: "in_progress",
    ...overrides,
  };
}

// --- unit + property tests ---------------------------------------------

describe("finalizeInterviewSession: status routing", () => {
  it("returns 404 when session is missing", async () => {
    const store: FakeStore = { session: null, emitted: [], usageEmittedFor: new Set() };
    const res = await finalizeInterviewSession(
      {
        sessionId: "missing",
        surveyId: "srv-1",
        terminalStatus: "completed",
        collectedAnswers: {},
      },
      makeDeps(store),
    );
    expect(res.status).toBe(404);
    if (res.status === 404) expect(res.body.error).toBe("session_not_found");
    expect(store.emitted).toEqual([]);
  });

  it("returns 400 on survey_mismatch (client sent wrong surveyId)", async () => {
    const store: FakeStore = {
      session: makeSession({ surveyId: "srv-1" }),
      emitted: [],
      usageEmittedFor: new Set(),
    };
    const res = await finalizeInterviewSession(
      {
        sessionId: "s-1",
        surveyId: "srv-2", // WRONG
        terminalStatus: "completed",
        collectedAnswers: {},
      },
      makeDeps(store),
    );
    expect(res.status).toBe(400);
    if (res.status === 400) expect(res.body.error).toBe("survey_mismatch");
    expect(store.emitted).toEqual([]);
  });

  it("returns 400 invalid_input on bad payload", async () => {
    const store: FakeStore = { session: null, emitted: [], usageEmittedFor: new Set() };
    const res = await finalizeInterviewSession({}, makeDeps(store));
    expect(res.status).toBe(400);
    if (res.status === 400) expect(res.body.error).toBe("invalid_input");
  });
});

describe("P-FIN-01: finalize is idempotent on already-terminal sessions", () => {
  it("second call on completed session does not re-emit usage or re-trigger analysis", async () => {
    const store: FakeStore = {
      session: makeSession({ state: "in_progress" }),
      emitted: [],
      usageEmittedFor: new Set(),
    };
    // First call transitions to completed
    const first = await finalizeInterviewSession(
      {
        sessionId: "s-1",
        surveyId: "srv-1",
        terminalStatus: "completed",
        collectedAnswers: { "q-1": { answer: "yes", source: "voice" } },
      },
      makeDeps(store),
    );
    expect(first.status).toBe(200);
    if (first.status === 200) {
      expect(first.body.terminalStatus).toBe("completed");
      expect(first.body.analysisTriggered).toBe(true);
    }
    const emittedAfterFirst = [...store.emitted];
    expect(emittedAfterFirst.filter((e) => e.kind === "usage").length).toBe(1);
    expect(emittedAfterFirst.filter((e) => e.kind === "analysis").length).toBe(1);

    // Second call — session is already `completed` → skip usage + analysis emit
    const second = await finalizeInterviewSession(
      {
        sessionId: "s-1",
        surveyId: "srv-1",
        terminalStatus: "completed",
        collectedAnswers: { "q-1": { answer: "yes", source: "voice" } },
      },
      makeDeps(store),
    );
    expect(second.status).toBe(200);
    // No new usage/analysis after retry — the completeness bar's idempotence.
    const afterSecond = store.emitted;
    expect(afterSecond.filter((e) => e.kind === "usage").length).toBe(1);
    expect(afterSecond.filter((e) => e.kind === "analysis").length).toBe(1);
    // update was called only once (first time)
    expect(afterSecond.filter((e) => e.kind === "update").length).toBe(1);
  });
});

describe("P-FIN-02: abandoned status updates state but does not emit usage or analysis", () => {
  it("abandoned → 1 update, 0 usage, 0 analysis", async () => {
    const store: FakeStore = {
      session: makeSession({ state: "in_progress" }),
      emitted: [],
      usageEmittedFor: new Set(),
    };
    const res = await finalizeInterviewSession(
      {
        sessionId: "s-1",
        surveyId: "srv-1",
        terminalStatus: "abandoned",
        collectedAnswers: {},
      },
      makeDeps(store),
    );
    expect(res.status).toBe(200);
    expect(store.emitted.filter((e) => e.kind === "update").length).toBe(1);
    expect(store.emitted.filter((e) => e.kind === "usage").length).toBe(0);
    expect(store.emitted.filter((e) => e.kind === "analysis").length).toBe(0);
  });
});

describe("P-FIN-03: transcript is persisted iff caller sends segments", () => {
  it("with transcript.segments → transcript emit; without → no transcript emit", async () => {
    fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (withTranscript, text) => {
          const store: FakeStore = {
            session: makeSession(),
            emitted: [],
            usageEmittedFor: new Set(),
          };
          const req = {
            sessionId: "s-1",
            surveyId: "srv-1",
            terminalStatus: "completed" as const,
            collectedAnswers: {},
            ...(withTranscript
              ? {
                  transcript: {
                    segments: [
                      { speaker: "respondent", startMs: 0, endMs: 1000, text },
                    ],
                    language: "zh",
                  },
                }
              : {}),
          };
          const res = await finalizeInterviewSession(req, makeDeps(store));
          expect(res.status).toBe(200);
          const transcriptCount = store.emitted.filter((e) => e.kind === "transcript").length;
          expect(transcriptCount).toBe(withTranscript ? 1 : 0);
          if (withTranscript) {
            expect(store.emitted.find((e) => e.kind === "transcript")).toMatchObject({
              sessionId: "s-1",
              body: {
                language: "zh",
                segments: [{ speaker: "respondent", startMs: 0, endMs: 1000, text }],
              },
            });
          }
        },
      ),
    );
  });
});
