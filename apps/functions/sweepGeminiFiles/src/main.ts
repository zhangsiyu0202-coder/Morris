// Appwrite scheduled Function entrypoint (ADR 0005 D2).
//
// DEPLOYMENT: set the Appwrite Function `schedule` to a CRON such as
// `*/30 * * * *` (every 30 min). The repo has no schedule-declaration
// mechanism, so the CRON is configured at deploy time, not in source.
// Runs under the server API key only; never interviewee-reachable.
import { createLogger } from "@merism/observability";
import { sweepGeminiFiles } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: unknown;
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ res, log, error }: Ctx) {
  const logger = createLogger("sweepGeminiFiles");

  // No GEMINI key => nothing to reclaim (feature never ran here). No-op.
  if (!process.env.GEMINI_API_KEY) {
    log("sweepGeminiFiles skipped (GEMINI_API_KEY unset)");
    return res.json({ skipped: true }, 200);
  }

  try {
    const result = await sweepGeminiFiles(createRealDeps());
    logger.info("gemini sweep cycle complete", { ...result });
    log(
      `sweepGeminiFiles -> scanned=${result.scanned} deleted=${result.deleted} ` +
        `failed=${result.deleteFailed} skipped=${result.skippedInFlight} ` +
        `reenqueued=${result.reenqueued} failedPermanent=${result.failedPermanent}`,
    );
    return res.json(result, 200);
  } catch (e) {
    // The sweep must never crash the schedule; surface via boundary shape.
    error(`sweepGeminiFiles failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("unhandled sweep error");
    return res.json({ error: "internal_error", traceId: logger.traceId }, 500);
  }
}
