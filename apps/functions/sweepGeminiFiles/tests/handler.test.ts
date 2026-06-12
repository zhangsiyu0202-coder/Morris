import { describe, expect, it, vi } from "vitest";
import {
  classifySweepJob,
  sweepGeminiFiles,
  DEFAULT_SWEEP_MIN_AGE_MS,
  type SweepDeps,
  type SweepJob,
} from "../src/handler";

const NOW = Date.UTC(2026, 5, 11, 12, 0, 0);
const OLD = NOW - DEFAULT_SWEEP_MIN_AGE_MS - 60_000; // safely past the cutoff
const RECENT = NOW - 60_000; // within the threshold

function job(overrides: Partial<SweepJob> = {}): SweepJob {
  return {
    sessionId: "s1",
    status: "succeeded",
    geminiFileName: "files/abc",
    geminiUploadedAtMs: OLD,
    ...overrides,
  };
}

describe("classifySweepJob (ADR 0005 D2)", () => {
  const cutoff = NOW - DEFAULT_SWEEP_MIN_AGE_MS;

  it("reclaims any terminal job regardless of age", () => {
    expect(classifySweepJob(job({ status: "succeeded", geminiUploadedAtMs: RECENT }), cutoff)).toBe("reclaim");
    expect(classifySweepJob(job({ status: "failed", geminiUploadedAtMs: RECENT }), cutoff)).toBe("reclaim");
  });

  it("reclaims a non-terminal job once aged past the cutoff (crashed mid-flight)", () => {
    expect(classifySweepJob(job({ status: "analyzing", geminiUploadedAtMs: OLD }), cutoff)).toBe("reclaim");
  });

  it("skips a recent non-terminal job (still in flight)", () => {
    expect(classifySweepJob(job({ status: "uploading", geminiUploadedAtMs: RECENT }), cutoff)).toBe("skip");
    expect(classifySweepJob(job({ status: "analyzing", geminiUploadedAtMs: null }), cutoff)).toBe("skip");
  });
});

function makeDeps(jobs: SweepJob[], overrides: Partial<SweepDeps> = {}) {
  const deleteGeminiFile = vi.fn(overrides.deleteGeminiFile ?? (async () => undefined));
  const clearJobFile = vi.fn(overrides.clearJobFile ?? (async () => undefined));
  const deps: SweepDeps = {
    now: () => NOW,
    listTrackedFiles: async () => jobs,
    deleteGeminiFile,
    clearJobFile,
    ...(overrides.maxFiles !== undefined ? { maxFiles: overrides.maxFiles } : {}),
    ...(overrides.deleteConcurrency !== undefined ? { deleteConcurrency: overrides.deleteConcurrency } : {}),
  };
  return Object.assign(deps, { deleteGeminiFile, clearJobFile });
}

describe("sweepGeminiFiles", () => {
  it("reclaims terminal + aged jobs, skips in-flight, and reports counts", async () => {
    const deps = makeDeps([
      job({ sessionId: "terminal", status: "succeeded", geminiUploadedAtMs: RECENT }),
      job({ sessionId: "aged", status: "analyzing", geminiUploadedAtMs: OLD }),
      job({ sessionId: "inflight", status: "uploading", geminiUploadedAtMs: RECENT }),
    ]);
    const result = await sweepGeminiFiles(deps);
    expect(result).toEqual({
      scanned: 3,
      reclaimed: 2,
      deleted: 2,
      deleteFailed: 0,
      skippedInFlight: 1,
      hitListCap: false,
      reenqueued: 0,
      failedPermanent: 0,
    });
    expect(deps.deleteGeminiFile).toHaveBeenCalledTimes(2);
    expect(deps.clearJobFile).toHaveBeenCalledWith("terminal");
    expect(deps.clearJobFile).toHaveBeenCalledWith("aged");
    expect(deps.clearJobFile).not.toHaveBeenCalledWith("inflight");
  });

  it("counts a delete failure and does not clear that row (left for next cycle)", async () => {
    const deps = makeDeps([job({ sessionId: "boom", status: "failed" })], {
      deleteGeminiFile: async () => {
        throw new Error("gemini delete 500");
      },
    });
    const result = await sweepGeminiFiles(deps);
    expect(result).toMatchObject({ reclaimed: 1, deleted: 0, deleteFailed: 1 });
    expect(deps.clearJobFile).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is tracked", async () => {
    const deps = makeDeps([]);
    const result = await sweepGeminiFiles(deps);
    expect(result).toEqual({
      scanned: 0,
      reclaimed: 0,
      deleted: 0,
      deleteFailed: 0,
      skippedInFlight: 0,
      hitListCap: false,
      reenqueued: 0,
      failedPermanent: 0,
    });
  });

  it("signals hitListCap when the listing fills its page (Gap C)", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      job({ sessionId: `s${i}`, status: "succeeded" }),
    );
    const deps = makeDeps(jobs, { maxFiles: 3 });
    const result = await sweepGeminiFiles(deps);
    expect(result.hitListCap).toBe(true);
    expect(result.deleted).toBe(3);
  });

  it("deletes every reclaimable job under bounded concurrency (Gap C)", async () => {
    const jobs = Array.from({ length: 7 }, (_, i) =>
      job({ sessionId: `s${i}`, status: "failed" }),
    );
    const deps = makeDeps(jobs, { deleteConcurrency: 3 });
    const result = await sweepGeminiFiles(deps);
    expect(result.reclaimed).toBe(7);
    expect(result.deleted).toBe(7);
    expect(deps.deleteGeminiFile).toHaveBeenCalledTimes(7);
    expect(deps.clearJobFile).toHaveBeenCalledTimes(7);
  });
});

import { decideReap, type RetryJob } from "../src/handler";

const REAP_OPTS = { nowMs: NOW, attemptCap: 3, stuckAfterMs: 15 * 60 * 1000 };
const REAP_OLD = NOW - REAP_OPTS.stuckAfterMs - 60_000;
const REAP_RECENT = NOW - 60_000;

function retryJob(overrides: Partial<RetryJob> = {}): RetryJob {
  return { sessionId: "s1", status: "queued", attemptCount: 0, updatedAtMs: REAP_OLD, ...overrides };
}

describe("decideReap (Gap B reaper)", () => {
  it("skips succeeded jobs", () => {
    expect(decideReap(retryJob({ status: "succeeded" }), REAP_OPTS)).toBe("skip");
  });
  it("skips recently-updated jobs (active or just-enqueued)", () => {
    expect(decideReap(retryJob({ status: "analyzing", updatedAtMs: REAP_RECENT }), REAP_OPTS)).toBe("skip");
  });
  it("re-enqueues an aged queued job whose execution was dropped", () => {
    expect(decideReap(retryJob({ status: "queued", attemptCount: 0 }), REAP_OPTS)).toBe("reenqueue");
  });
  it("re-enqueues an aged crashed in-progress job under the cap", () => {
    expect(decideReap(retryJob({ status: "analyzing", attemptCount: 1 }), REAP_OPTS)).toBe("reenqueue");
  });
  it("re-enqueues an aged failed job under the cap", () => {
    expect(decideReap(retryJob({ status: "failed", attemptCount: 2 }), REAP_OPTS)).toBe("reenqueue");
  });
  it("fails permanently an aged non-terminal job at the cap", () => {
    expect(decideReap(retryJob({ status: "analyzing", attemptCount: 3 }), REAP_OPTS)).toBe("fail_permanent");
  });
  it("skips an aged failed job at the cap (already permanently failed)", () => {
    expect(decideReap(retryJob({ status: "failed", attemptCount: 3 }), REAP_OPTS)).toBe("skip");
  });
});

describe("sweepGeminiFiles reaper pass (Gap B)", () => {
  it("re-enqueues stalled/dropped jobs and fails stuck-at-cap jobs", async () => {
    const reenqueue = vi.fn(async () => undefined);
    const failJob = vi.fn(async () => undefined);
    const candidates: RetryJob[] = [
      retryJob({ sessionId: "dropped-queued", status: "queued", attemptCount: 0 }),
      retryJob({ sessionId: "crashed", status: "analyzing", attemptCount: 1 }),
      retryJob({ sessionId: "stuck-at-cap", status: "consolidating", attemptCount: 3 }),
      retryJob({ sessionId: "recent", status: "analyzing", attemptCount: 1, updatedAtMs: REAP_RECENT }),
    ];
    const deps: SweepDeps = {
      now: () => NOW,
      listTrackedFiles: async () => [],
      deleteGeminiFile: vi.fn(async () => undefined),
      clearJobFile: vi.fn(async () => undefined),
      listRetryCandidates: async () => candidates,
      reenqueue,
      failJob,
    };
    const result = await sweepGeminiFiles(deps);
    expect(result.reenqueued).toBe(2); // dropped-queued + crashed
    expect(result.failedPermanent).toBe(1); // stuck-at-cap
    expect(reenqueue).toHaveBeenCalledWith("dropped-queued");
    expect(reenqueue).toHaveBeenCalledWith("crashed");
    expect(failJob).toHaveBeenCalledWith("stuck-at-cap");
    expect(reenqueue).not.toHaveBeenCalledWith("recent");
  });
});
