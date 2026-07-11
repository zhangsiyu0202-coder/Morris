import { describe, expect, it } from "vitest";
import { decideClaim, type ExistingJob } from "../src/claim";

const OPTS = { nowMs: 1_000_000, attemptCap: 3, stuckAfterMs: 60_000 };

function job(overrides: Partial<ExistingJob>): ExistingJob {
  return { status: "queued", attemptCount: 0, updatedAtMs: OPTS.nowMs, ...overrides };
}

describe("decideClaim (ADR 0005 retry state machine)", () => {
  it("creates when no row exists (direct invoke)", () => {
    expect(decideClaim(null, OPTS)).toEqual({ action: "create", nextStatus: "analyzing", nextAttemptCount: 1 });
  });

  it("claims a queued row (durable trigger from analyzeSession)", () => {
    expect(decideClaim(job({ status: "queued", attemptCount: 0 }), OPTS)).toEqual({
      action: "claim",
      nextStatus: "analyzing",
      nextAttemptCount: 1,
    });
  });

  it("skips a succeeded row", () => {
    expect(decideClaim(job({ status: "succeeded" }), OPTS)).toEqual({ action: "skip", status: "succeeded" });
  });

  it("skips an in-flight row that was updated recently (active runner)", () => {
    const j = job({ status: "analyzing", attemptCount: 1, updatedAtMs: OPTS.nowMs - 1_000 });
    expect(decideClaim(j, OPTS)).toEqual({ action: "skip", status: "analyzing" });
  });

  it("reclaims a stuck in-flight row past stuckAfterMs when under the cap", () => {
    const j = job({ status: "analyzing", attemptCount: 1, updatedAtMs: OPTS.nowMs - 120_000 });
    expect(decideClaim(j, OPTS)).toEqual({ action: "claim", nextStatus: "analyzing", nextAttemptCount: 2 });
  });

  it("fails a stuck in-flight row permanently at the attempt cap", () => {
    const j = job({ status: "analyzing", attemptCount: 3, updatedAtMs: OPTS.nowMs - 120_000 });
    expect(decideClaim(j, OPTS)).toEqual({ action: "fail_permanent", status: "failed" });
  });

  it("retries a failed row under the cap", () => {
    expect(decideClaim(job({ status: "failed", attemptCount: 1 }), OPTS)).toEqual({
      action: "claim",
      nextStatus: "analyzing",
      nextAttemptCount: 2,
    });
  });

  it("skips a failed row at the cap (permanently failed)", () => {
    expect(decideClaim(job({ status: "failed", attemptCount: 3 }), OPTS)).toEqual({ action: "skip", status: "failed" });
  });
});
