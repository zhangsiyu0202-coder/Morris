/**
 * Byte-parity between TS composer output and a checked-in golden fixture.
 *
 * Historical context: this fixture used to live at
 * `apps/agent/tests/__fixtures__/branch-e2e-flow-config.json` and was
 * consumed by the Python `test_flow_engine_branch_e2e.py` E2E test. Per
 * ADR-0013 the Python worker was removed; the fixture was preserved into
 * this package so the TS composer still has a golden target. When the
 * flow-engine-ts-reimpl sub-spec lands and re-hosts the E2E on the TS
 * agent-voice-worker, that new E2E will read from the same path.
 *
 * The test regenerates the composer output on every run and asserts
 * structural equality (deep) against the fixture. Two failure modes it
 * catches:
 *   1. Composer output shape changes (new/removed fields, reordered items).
 *   2. The equivalent-draft below and the fixture-defining draft drift
 *      apart — inputs no longer match.
 *
 * How to update: run this test, if it fails, examine the diff. If the
 * composer change is intentional, replace the fixture with the actual
 * composer output (checked-in JSON, no vitest snapshot mode).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInterviewFlowConfigFromDraft,
  SurveyDraftSchema,
  type SurveyDraft,
} from "../src/api.js";

// Fixture lives inside this package now (see JSDoc header above).
const FIXTURE_PATH = join(__dirname, "__fixtures__", "branch-e2e-flow-config.json");

function equivalentDraft(): SurveyDraft {
  return SurveyDraftSchema.parse({
    title: "Occupation Study",
    researchGoal: "test branches",
    targetAudience: "testers",
    introScript: "Hi.",
    moderatorInstruction: "",
    sections: [
      {
        title: "Q",
        objective: "test",
        questions: [
          {
            stableId: "s1",
            questionText: "你的日常状态是什么?",
            questionType: "open_ended",
            probeLevel: "standard",
            probeInstruction: "",
            options: [],
            allowSkip: false,
            branchRules: [
              { condition: "用户是全职学生", jumpToQuestionId: "s2" },
              { condition: "用户在工作或创业", jumpToQuestionId: "s3" },
            ],
          },
          {
            stableId: "s2",
            questionText: "你的专业是什么?",
            questionType: "open_ended",
            probeLevel: "standard",
            probeInstruction: "",
            options: [],
            allowSkip: false,
            branchRules: [],
          },
          {
            stableId: "s3",
            questionText: "你从事什么工作?",
            questionType: "open_ended",
            probeLevel: "standard",
            probeInstruction: "",
            options: [],
            allowSkip: false,
            branchRules: [],
          },
        ],
      },
    ],
  });
}

describe("branch-e2e fixture parity (TS composer ↔ Python E2E fixture)", () => {
  it("buildInterviewFlowConfigFromDraft emits exactly what the Python fixture contains", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-branch",
      sessionId: "sess-branch",
      draft: equivalentDraft(),
    });

    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

    // Structural (deep) equality — same as JSON.parse(a) === JSON.parse(b)
    // semantically. Catches added/removed fields, changed values, reordered
    // items. Order of KEYS inside an object is normalized by toEqual; order
    // of ELEMENTS inside arrays is preserved (which is what we want — item
    // order and edge order matter for first-match semantics).
    expect(cfg).toEqual(fixture);
  });
});
