// Pure core for sweepGeminiFiles (ADR 0005 D2) — the visual-job reconciler.
//
// Two responsibilities, both reimplementing PostHog's Temporal-side guarantees
// on Appwrite job rows:
//   1. FILE GC: reclaim orphaned Gemini Files (terminal job, or non-terminal but
//      aged-stuck) under bounded concurrency, with a hit-cap signal.
//      (PostHog gemini_cleanup_sweep.)
//   2. REAPER (Gap B): re-drive stalled jobs so a crashed/dropped run resumes —
//      a queued row whose async execution was dropped, or a non-terminal run
//      that crashed, gets re-enqueued (bounded by attemptCount); a stuck job at
//      the attempt cap is failed permanently. (PostHog Temporal RetryPolicy.)
//
// Never throws out of the boundary — failures are counted; Google's ~48h
// auto-purge backstops files, and the next cycle retries everything else.

import {
  MAX_VISUAL_ANALYSIS_ATTEMPTS,
  VISUAL_ANALYSIS_JOB_TERMINAL_STATUSES,
  type VisualAnalysisJobStatusValue,
} from "@merism/contracts";

export const DEFAULT_SWEEP_MIN_AGE_MS = 30 * 60 * 1000; // 30 min — orphan-file age
export const DEFAULT_DELETE_CONCURRENCY = 5; // mirrors PostHog DELETE_CONCURRENCY
export const DEFAULT_STUCK_AFTER_MS = 15 * 60 * 1000; // 15 min — stalled-job age

const TERMINAL = new Set<string>(VISUAL_ANALYSIS_JOB_TERMINAL_STATUSES);

export interface SweepJob {
  sessionId: string;
  status: VisualAnalysisJobStatusValue;
  /** Non-null — only tracked files (geminiFileName set) are listed. */
  geminiFileName: string;
  geminiUploadedAtMs: number | null;
}

export interface RetryJob {
  sessionId: string;
  status: VisualAnalysisJobStatusValue;
  attemptCount: number;
  /** Epoch ms of the row's last update; used to detect a stalled/dropped job. */
  updatedAtMs: number;
}

export interface SweepDeps {
  now(): number;
  minAgeMs?: number;
  maxFiles?: number;
  deleteConcurrency?: number;
  /** Attempt cap for the reaper (defaults to MAX_VISUAL_ANALYSIS_ATTEMPTS). */
  attemptCap?: number;
  /** A non-terminal job not updated within this window is treated as stalled. */
  stuckAfterMs?: number;
  listTrackedFiles(): Promise<SweepJob[]>;
  deleteGeminiFile(geminiFileName: string): Promise<void>;
  clearJobFile(sessionId: string): Promise<void>;
  // --- reaper (optional; omitted when no analyzeSessionVisual function id) ---
  listRetryCandidates?(): Promise<RetryJob[]>;
  reenqueue?(sessionId: string): Promise<void>;
  failJob?(sessionId: string): Promise<void>;
}

export interface SweepResult {
  scanned: number;
  reclaimed: number;
  deleted: number;
  deleteFailed: number;
  skippedInFlight: number;
  hitListCap: boolean;
  reenqueued: number;
  failedPermanent: number;
}

export interface ReapOptions {
  nowMs: number;
  attemptCap: number;
  stuckAfterMs: number;
}

export function classifySweepJob(job: SweepJob, cutoffMs: number): "reclaim" | "skip" {
  if (TERMINAL.has(job.status)) return "reclaim";
  if (job.geminiUploadedAtMs !== null && job.geminiUploadedAtMs < cutoffMs) return "reclaim";
  return "skip";
}

/**
 * Reaper decision for one job. Succeeded => done. Recent => leave it (active or
 * just-enqueued). Aged failed/queued/in-progress under the cap => re-enqueue
 * (the runner's claim state machine does the attempt accounting). Aged
 * non-terminal at the cap => fail permanently. Pure — no I/O.
 */
export function decideReap(job: RetryJob, opts: ReapOptions): "reenqueue" | "fail_permanent" | "skip" {
  if (job.status === "succeeded") return "skip";
  const aged = opts.nowMs - job.updatedAtMs >= opts.stuckAfterMs;
  if (!aged) return "skip";
  if (job.status === "failed") {
    return job.attemptCount < opts.attemptCap ? "reenqueue" : "skip";
  }
  // queued or in-progress, aged
  return job.attemptCount < opts.attemptCap ? "reenqueue" : "fail_permanent";
}

export async function sweepGeminiFiles(deps: SweepDeps): Promise<SweepResult> {
  const nowMs = deps.now();
  const minAgeMs = deps.minAgeMs ?? DEFAULT_SWEEP_MIN_AGE_MS;
  const cutoffMs = nowMs - minAgeMs;

  // --- pass 1: orphan-file GC ---
  const jobs = await deps.listTrackedFiles();
  const hitListCap = deps.maxFiles !== undefined && jobs.length >= deps.maxFiles;
  const toReclaim = jobs.filter((job) => classifySweepJob(job, cutoffMs) === "reclaim");
  const skippedInFlight = jobs.length - toReclaim.length;

  const concurrency = Math.max(1, Math.floor(deps.deleteConcurrency ?? DEFAULT_DELETE_CONCURRENCY));
  const outcomes = await mapWithConcurrency(toReclaim, concurrency, async (job) => {
    try {
      await deps.deleteGeminiFile(job.geminiFileName);
      await deps.clearJobFile(job.sessionId);
      return true;
    } catch {
      return false;
    }
  });
  const deleted = outcomes.filter(Boolean).length;

  // --- pass 2: reaper (re-drive stalled jobs) ---
  let reenqueued = 0;
  let failedPermanent = 0;
  if (deps.listRetryCandidates && deps.reenqueue && deps.failJob) {
    const reapOpts: ReapOptions = {
      nowMs,
      attemptCap: deps.attemptCap ?? MAX_VISUAL_ANALYSIS_ATTEMPTS,
      stuckAfterMs: deps.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS,
    };
    const candidates = await deps.listRetryCandidates();
    for (const job of candidates) {
      const decision = decideReap(job, reapOpts);
      if (decision === "reenqueue") {
        try {
          await deps.reenqueue(job.sessionId);
          reenqueued++;
        } catch {
          // leave for next cycle
        }
      } else if (decision === "fail_permanent") {
        try {
          await deps.failJob(job.sessionId);
          failedPermanent++;
        } catch {
          // leave for next cycle
        }
      }
    }
  }

  return {
    scanned: jobs.length,
    reclaimed: toReclaim.length,
    deleted,
    deleteFailed: toReclaim.length - deleted,
    skippedInFlight,
    hitListCap,
    reenqueued,
    failedPermanent,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
