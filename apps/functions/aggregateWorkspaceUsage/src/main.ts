// Appwrite scheduled Function (CRON). No request body; rolls up usage for all
// workspaces in the current billing period.
import { withErrorBoundary } from "@merism/observability";
import { aggregateWorkspaceUsage } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ res, log, error }: Ctx) {
  const boundary = await withErrorBoundary("aggregateWorkspaceUsage", async (logger) => {
    const summary = await aggregateWorkspaceUsage(createRealDeps());
    logger.info("usage aggregated", {
      processed: summary.processed,
      skipped: summary.skipped,
      over: summary.over,
    });
    log(`aggregateWorkspaceUsage -> processed=${summary.processed} over=${summary.over}`);
    return summary;
  });

  if (boundary.ok) {
    return res.json({ ok: true, ...boundary.data });
  }
  error(`aggregateWorkspaceUsage unhandled (traceId=${boundary.traceId})`);
  return res.json(
    { ok: false, error: boundary.error, traceId: boundary.traceId },
    boundary.status,
  );
}
