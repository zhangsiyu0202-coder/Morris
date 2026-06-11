// Appwrite Function entrypoint (Node 20 runtime). Enqueued by analyzeSession
// after the text report is persisted (ADR 0005 D1). Async execution.
import { createLogger } from "@merism/observability";
import { analyzeSessionVisual } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  const logger = createLogger("analyzeSessionVisual");

  // The whole visual pipeline is gated by the feature flag — no-op when off.
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

  try {
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
    return res.json(result.body, result.status);
  } catch (e) {
    error(`analyzeSessionVisual failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("unhandled error");
    return res.json({ error: "internal_error", traceId: logger.traceId }, 500);
  }
}
