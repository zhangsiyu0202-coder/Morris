import { withErrorBoundary } from "@merism/observability";
import { createRealDeps } from "./deps.js";
import { analyzeEvidence } from "./handler.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (message: string) => void;
  error: (message: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  let input: unknown = req.bodyJson;
  if (input === undefined && req.bodyRaw) {
    try {
      input = JSON.parse(req.bodyRaw);
    } catch {
      input = undefined;
    }
  }
  const boundary = await withErrorBoundary("analyzeEvidence", async (logger) => {
    const result = await analyzeEvidence(input, createRealDeps());
    if (result.status === 200) {
      logger.info("evidence indexed", result.body);
    } else {
      logger.warn("evidence indexing rejected", { status: result.status, error: result.body.error });
    }
    log(`analyzeEvidence -> ${result.status}`);
    return result;
  });
  if (boundary.ok) return res.json(boundary.data.body, boundary.data.status);
  error(`analyzeEvidence unhandled (traceId=${boundary.traceId})`);
  return res.json({ error: boundary.error, traceId: boundary.traceId }, boundary.status);
}
