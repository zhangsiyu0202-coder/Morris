// Appwrite scheduled Function (CRON). No request body; rolls up usage for all
// workspaces in the current billing period.
import { createLogger } from "@merism/observability";
import { aggregateWorkspaceUsage } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ res, log, error }: Ctx) {
  const logger = createLogger("aggregateWorkspaceUsage");
  try {
    const summary = await aggregateWorkspaceUsage(createRealDeps());
    logger.info("usage aggregated", { processed: summary.processed, skipped: summary.skipped, over: summary.over });
    log(`aggregateWorkspaceUsage -> processed=${summary.processed} over=${summary.over}`);
    return res.json({ ok: true, ...summary });
  } catch (e) {
    error(`aggregateWorkspaceUsage failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("unhandled error");
    return res.json({ ok: false, error: "internal_error", traceId: logger.traceId }, 500);
  }
}
