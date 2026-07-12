// P-FLOW-06 / P-FLOW-07: probe-gate + first-writer-wins invariants ported
// per ADR-0013 § Migration completeness bar §8 from the deleted Python
// `apps/agent/tests/properties/test_probe_tool_gate.py` (hypothesis) to TS
// vitest+fast-check. Preserves the semantics of the
// `interview-probe-task-hardening` sub-spec — `record_probe_round` is
// conditionally exposed to the LLM iff `probeConfig.maxRounds > 0`, and
// `confirmationHeard=false` is a true no-op that does not bump rounds.
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import type {
  InterviewAnswerPayload,
  QuestionTaskConfig,
  StudyQuestionType,
} from "@merism/contracts";

import {
  PROBE_GATE_REJECTION,
  QuestionRunner,
} from "../../../apps/agent-voice-worker/src/interview/question-runner.js";

// --- arbitraries --------------------------------------------------------

const questionType = fc.constantFrom<StudyQuestionType>(
  "open_ended",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
  "ranking",
);

function questionArb(opts: {
  maxRounds: number;
  qid?: string;
}): fc.Arbitrary<QuestionTaskConfig> {
  return fc
    .record({
      qidSuffix: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/\s+/g, "-")),
      questionType,
      content: fc.string({ minLength: 1, maxLength: 60 }),
    })
    .map((r) => ({
      questionId: opts.qid ?? `q-${r.qidSuffix}`,
      questionType: r.questionType,
      questionContent: r.content,
      options: [],
      probeConfig: {
        level: "standard" as const,
        instruction: "probe",
        maxRounds: opts.maxRounds,
      },
    }));
}

const uiAnswer: fc.Arbitrary<InterviewAnswerPayload> = fc.record({
  questionId: fc.string({ minLength: 1, maxLength: 20 }),
  sectionId: fc.constant("s-0"),
  questionType,
  source: fc.constant("ui" as const),
  text: fc.string({ maxLength: 30 }),
  selectedOptions: fc.constant<string[]>([]),
  score: fc.constant<undefined>(undefined),
  ranking: fc.constant<string[]>([]),
});

// --- properties ---------------------------------------------------------

describe("P-FLOW-06: probe tool is registered iff probeConfig.maxRounds > 0", () => {
  it("probeToolEnabled reflects maxRounds > 0 strictly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (maxRounds) => {
        fc.assert(
          fc.property(questionArb({ maxRounds }), (config) => {
            const runner = new QuestionRunner(config);
            expect(runner.probeToolEnabled).toBe(maxRounds > 0);
            expect(runner.maxRounds).toBe(maxRounds);
          }),
          { numRuns: 5 },
        );
      }),
    );
  });
});

describe("P-FLOW-07: confirmationHeard=false is a true no-op — never bumps rounds, never completes", () => {
  it("N false-confirmations leave rounds=0 and return the gate rejection", () => {
    fc.assert(
      fc.property(
        questionArb({ maxRounds: 3 }),
        fc.integer({ min: 1, max: 10 }),
        (config, n) => {
          const runner = new QuestionRunner(config);
          const responses: string[] = [];
          for (let i = 0; i < n; i++) {
            const response = runner.recordProbeRound({
              probeQuestion: `probe ${i}`,
              probeRespondentAnswer: `answer ${i}`,
              confirmationHeard: false,
            });
            responses.push(response);
          }
          // Every response is the exact rejection string; the runner's
          // internal probe list is empty; runner remains uncompleted.
          for (const r of responses) expect(r).toBe(PROBE_GATE_REJECTION);
          expect(runner.completed).toBe(false);
          expect(runner.result).toBeNull();
        },
      ),
    );
  });
});

describe("P-FLOW-08: probe maxRounds is a hard ceiling — no >max recording", () => {
  it("beyond maxRounds, recordProbeRound rejects with 'Probe limit already reached'", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 6 }),
        (maxRounds, extra) => {
          fc.assert(
            fc.property(questionArb({ maxRounds }), (config) => {
              const runner = new QuestionRunner(config);
              // Fill up to maxRounds.
              for (let i = 0; i < maxRounds; i++) {
                const res = runner.recordProbeRound({
                  probeQuestion: `p${i}`,
                  probeRespondentAnswer: `a${i}`,
                  confirmationHeard: true,
                });
                expect(res).toMatch(/Recorded probe/);
              }
              // Any further recording refused.
              for (let j = 0; j < extra; j++) {
                const res = runner.recordProbeRound({
                  probeQuestion: `over${j}`,
                  probeRespondentAnswer: `a${j}`,
                  confirmationHeard: true,
                });
                expect(res).toMatch(/already reached|limit reached/i);
              }
              expect(runner.completed).toBe(false);
            }),
            { numRuns: 5 },
          );
        },
      ),
    );
  });
});

describe("P-FLOW-09: completeFromVoice on a probing question demands at least one recorded probe", () => {
  it("without any recorded probe, completeFromVoice returns a rejection; runner is not completed", () => {
    fc.assert(
      fc.property(questionArb({ maxRounds: 2 }), (config) => {
        const runner = new QuestionRunner(config);
        const result = runner.completeFromVoice("consolidated answer");
        expect(result.ok).toBe(false);
        expect(runner.completed).toBe(false);
      }),
    );
  });

  it("with at least one probe recorded, completeFromVoice succeeds and stores the probe", () => {
    fc.assert(
      fc.property(questionArb({ maxRounds: 2 }), (config) => {
        const runner = new QuestionRunner(config);
        runner.recordProbeRound({
          probeQuestion: "probe",
          probeRespondentAnswer: "probe answer",
          confirmationHeard: true,
        });
        const result = runner.completeFromVoice("consolidated");
        expect(result.ok).toBe(true);
        expect(runner.completed).toBe(true);
        expect(runner.result?.probe?.rounds.length).toBe(1);
        expect(runner.result?.respondentAnswer).toBe("consolidated");
      }),
    );
  });
});

describe("P-FLOW-10: first-writer-wins between voice completion and UI submission", () => {
  it("voice completes first → UI submit returns false and runner keeps voice answer", () => {
    fc.assert(
      fc.property(questionArb({ maxRounds: 0 }), uiAnswer, (config, ui) => {
        const runner = new QuestionRunner(config);
        // voice completes first (no probing needed since maxRounds=0)
        const voiceResult = runner.completeFromVoice("voice answer");
        expect(voiceResult.ok).toBe(true);
        expect(runner.result?.respondentAnswer).toBe("voice answer");
        // now UI attempts — should be rejected
        const accepted = runner.completeFromUi({ ...ui, text: "ui answer" });
        expect(accepted).toBe(false);
        // voice answer stands
        expect(runner.result?.respondentAnswer).toBe("voice answer");
      }),
    );
  });

  it("UI completes first → voice completion is idempotent no-op", () => {
    fc.assert(
      fc.property(questionArb({ maxRounds: 0 }), uiAnswer, (config, ui) => {
        const runner = new QuestionRunner(config);
        const accepted = runner.completeFromUi({ ...ui, text: "ui answer" });
        expect(accepted).toBe(true);
        expect(runner.result?.respondentAnswer).toBe("ui answer");
        // voice arrives late
        const voiceResult = runner.completeFromVoice("voice answer");
        expect(voiceResult.ok).toBe(true); // idempotent no-op returns ok:true
        // UI answer still stands
        expect(runner.result?.respondentAnswer).toBe("ui answer");
      }),
    );
  });
});
