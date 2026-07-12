// P-RPC-01 through P-RPC-03: `merism.submit_answer` RPC acceptance
// invariants, ported per ADR-0013 § Migration completeness bar §8 from the
// deleted Python `apps/agent/tests/test_supervisor_submit_answer.py`. The
// pure gate function `shouldAcceptUiAnswer` (in workflow-state.ts) is the
// spec — an UI answer only counts when there is an active question task
// AND the submitted questionId matches the authoritative cursor.
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { shouldAcceptUiAnswer } from "../../../apps/agent-voice-worker/src/interview/workflow-state.js";

describe("P-RPC-01: shouldAcceptUiAnswer requires an active task", () => {
  it("hasActiveTask=false → always rejected regardless of ids", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (submitted, current) => {
          expect(
            shouldAcceptUiAnswer({
              submittedQuestionId: submitted,
              currentQuestionId: current,
              hasActiveTask: false,
            }),
          ).toBe(false);
        },
      ),
    );
  });
});

describe("P-RPC-02: shouldAcceptUiAnswer requires currentQuestionId != null", () => {
  it("currentQuestionId=null → rejected even when hasActiveTask=true", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (submitted) => {
        expect(
          shouldAcceptUiAnswer({
            submittedQuestionId: submitted,
            currentQuestionId: null,
            hasActiveTask: true,
          }),
        ).toBe(false);
        expect(
          shouldAcceptUiAnswer({
            submittedQuestionId: submitted,
            currentQuestionId: undefined,
            hasActiveTask: true,
          }),
        ).toBe(false);
      }),
    );
  });
});

describe("P-RPC-03: shouldAcceptUiAnswer requires exact questionId match", () => {
  it("matching id + active task → accepted", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (qid) => {
        expect(
          shouldAcceptUiAnswer({
            submittedQuestionId: qid,
            currentQuestionId: qid,
            hasActiveTask: true,
          }),
        ).toBe(true);
      }),
    );
  });

  it("mismatching id → rejected", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (a, b) => {
          fc.pre(a !== b);
          expect(
            shouldAcceptUiAnswer({
              submittedQuestionId: a,
              currentQuestionId: b,
              hasActiveTask: true,
            }),
          ).toBe(false);
        },
      ),
    );
  });
});
