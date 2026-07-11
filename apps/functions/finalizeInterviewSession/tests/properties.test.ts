import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { finalizeInterviewSession } from "../src/handler";

describe("finalizeInterviewSession properties", () => {
  it("never emits usage events for abandoned sessions", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 300_000 }), fc.integer({ min: 0, max: 10 }), async (durationMs, answeredCount) => {
        let usageCalls = 0;
        const result = await finalizeInterviewSession(
          {
            sessionId: "sess1",
            surveyId: "sv1",
            state: "abandoned",
            collectedAnswers: {},
            transcript: { segments: [], language: "zh" },
            durationMs,
            answeredCount,
          },
          {
            nowIso: () => "2026-07-04T00:00:00.000Z",
            resolveSurveyTenancy: async () => ({ ownerUserId: "u1", workspaceId: "ws1" }),
            upsertTranscript: async () => {},
            deleteTranscript: async () => {},
            completeSession: async () => {},
            upsertRecording: async () => {},
            createUsageEvent: async () => {
              usageCalls += 1;
            },
            triggerPostSessionAnalysis: async () => {},
          },
        );

        expect(result.status).toBe(200);
        expect(usageCalls).toBe(0);
      }),
    );
  });
});
