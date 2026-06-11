// Pure claim state machine for analyzeSessionVisual (ADR 0005 D1/D3).
//
// Decides what a runner should do given the current job row. This is the
// Temporal-RetryPolicy equivalent without Temporal: each real run is one
// "attempt"; crashed/stuck non-terminal jobs and below-cap failures are
// re-claimable, succeeded jobs are done, and at the attempt cap a stuck job is
// failed permanently. Pure — no I/O — so it is unit/property tested directly.

import type { VisualAnalysisJobStatusValue } from "@merism/contracts";

export interface ExistingJob {
  status: VisualAnalysisJobStatusValue;
  attemptCount: number;
  /** Epoch ms of the row's last update; used to detect a stuck in-flight run. */
  updatedAtMs: number;
}

export interface ClaimOptions {
  nowMs: number;
  attemptCap: number;
  /** A non-terminal job whose updatedAt is older than this is treated as crashed. */
  stuckAfterMs: number;
}

export type ClaimDecision =
  | { action: "create"; nextStatus: "analyzing"; nextAttemptCount: number }
  | { action: "claim"; nextStatus: "analyzing"; nextAttemptCount: number }
  | { action: "skip"; status: VisualAnalysisJobStatusValue }
  | { action: "fail_permanent"; status: "failed" };

const IN_PROGRESS = new Set<VisualAnalysisJobStatusValue>(["uploading", "analyzing", "consolidating"]);

export function decideClaim(existing: ExistingJob | null, opts: ClaimOptions): ClaimDecision {
  if (!existing) {
    return { action: "create", nextStatus: "analyzing", nextAttemptCount: 1 };
  }

  if (existing.status === "succeeded") {
    return { action: "skip", status: "succeeded" };
  }

  if (existing.status === "queued") {
    return { action: "claim", nextStatus: "analyzing", nextAttemptCount: existing.attemptCount + 1 };
  }

  if (IN_PROGRESS.has(existing.status)) {
    const aged = opts.nowMs - existing.updatedAtMs >= opts.stuckAfterMs;
    if (!aged) return { action: "skip", status: existing.status }; // an active run owns it
    if (existing.attemptCount < opts.attemptCap) {
      return { action: "claim", nextStatus: "analyzing", nextAttemptCount: existing.attemptCount + 1 };
    }
    return { action: "fail_permanent", status: "failed" };
  }

  // status === "failed"
  if (existing.attemptCount < opts.attemptCap) {
    return { action: "claim", nextStatus: "analyzing", nextAttemptCount: existing.attemptCount + 1 };
  }
  return { action: "skip", status: "failed" };
}
