import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { deriveUsageRollup } from "../../../apps/functions/aggregateWorkspaceUsage/src/handler";
import { hardCeilingFor, isBillableInterview, COMPLETED_INTERVIEW_MIN_DURATION_MS } from "@merism/contracts";

/**
 * P-WB-03 — Quota + billable-unit invariants (ADR 0006 FR-U3/FR-U4).
 */
describe("P-WB-03 quota invariants", () => {
  it("hardCeiling >= included; state flips over exactly at the ceiling", () => {
    fc.assert(
      fc.property(fc.nat(500), fc.nat(2000), (included, used) => {
        const r = deriveUsageRollup({
          workspaceId: "w", periodStart: "s", periodEnd: "e",
          completedInterviews: used, includedInterviews: included,
        });
        expect(r.quota.hardCeiling).toBe(hardCeilingFor(included));
        expect(r.quota.hardCeiling).toBeGreaterThanOrEqual(included);
        expect(r.quota.usedInterviews).toBe(used);
        expect(r.quota.state).toBe(used >= hardCeilingFor(included) ? "over" : "ok");
      }),
    );
  });

  it("isBillableInterview requires completed + min duration + >=1 answer", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("created", "in_progress", "completed", "abandoned", "failed"),
        fc.nat(600_000),
        fc.nat(20),
        (state, durationMs, answeredCount) => {
          const expected =
            state === "completed" && durationMs >= COMPLETED_INTERVIEW_MIN_DURATION_MS && answeredCount >= 1;
          expect(isBillableInterview({ state, durationMs, answeredCount })).toBe(expected);
        },
      ),
    );
  });
});
