// Appwrite Function entrypoint (Node 20 runtime). Enqueued by analyzeSession
// after the text report is persisted (ADR 0005 D1). Async execution.
import { withErrorBoundary } from "@merism/observability";
import { analyzeSessionVisual } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  // The whole visual pipeline is gated by the feature flag — no-op when off.
  // Gate runs OUTSIDE the boundary because it is the cheapest possible
  // happy path (no logger, no traceId needed for a configured-off no-op).
  if (process.env.GEMINI_VISUAL_ANALYSIS_ENABLED !== "true") {
    log("analyzeSessionVisual disabled (GEMINI_VISUAL_ANALYSIS_ENABLED != true)");
    return res.json({ disabled: true }, 200);
  }

  let input: unknown = req.bodyJson;
  if (input === undefined && req.bodyRaw) {
    try {
      input = JSON.parse(req.bodyRaw);
    } catch {
      input = undefined;
    }
  }

  const boundary = await withErrorBoundary("analyzeSessionVisual", async (logger) => {
    const result = await analyzeSessionVisual(input, createRealDeps());
    if (result.status === 200) {
      logger.info("visual job processed", {
        jobId: result.body.jobId,
        status: result.body.status,
        claimed: result.body.claimed,
      });
    } else {
      logger.warn("visual job rejected", { status: result.status, error: result.body.error });
    }
    log(`analyzeSessionVisual -> ${result.status}`);
    return result;
  });

  if (boundary.ok) {
    return res.json(boundary.data.body, boundary.data.status);
  }
  error(`analyzeSessionVisual unhandled (traceId=${boundary.traceId})`);
  return res.json({ error: boundary.error, traceId: boundary.traceId }, boundary.status);
}
