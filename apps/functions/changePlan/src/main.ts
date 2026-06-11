import { createLogger } from "@merism/observability";
import { changePlan } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string; headers?: Record<string, string> };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  const logger = createLogger("changePlan");
  let input: unknown = req.bodyJson;
  if (input === undefined && req.bodyRaw) {
    try { input = JSON.parse(req.bodyRaw); } catch { input = undefined; }
  }
  const callerUserId = req.headers?.["x-appwrite-user-id"] ?? null;
  try {
    const result = await changePlan(input, createRealDeps(callerUserId));
    if (result.status !== 200) logger.warn("changePlan rejected", { status: result.status, error: result.body.error });
    log(`changePlan -> ${result.status}`);
    return res.json(result.body, result.status);
  } catch (e) {
    error(`changePlan failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("unhandled error");
    return res.json({ error: "internal_error", traceId: logger.traceId }, 500);
  }
}
