import { withErrorBoundary } from "@merism/observability";
import { changePlan } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string; headers?: Record<string, string> };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  let input: unknown = req.bodyJson;
  if (input === undefined && req.bodyRaw) {
    try { input = JSON.parse(req.bodyRaw); } catch { input = undefined; }
  }
  const callerUserId = req.headers?.["x-appwrite-user-id"] ?? null;

  const boundary = await withErrorBoundary("changePlan", async (logger) => {
    const result = await changePlan(input, createRealDeps(callerUserId));
    if (result.status !== 200) logger.warn("changePlan rejected", { status: result.status, error: result.body.error });
    log(`changePlan -> ${result.status}`);
    return result;
  });

  if (boundary.ok) {
    return res.json(boundary.data.body, boundary.data.status);
  }
  error(`changePlan unhandled (traceId=${boundary.traceId})`);
  return res.json({ error: boundary.error, traceId: boundary.traceId }, boundary.status);
}
