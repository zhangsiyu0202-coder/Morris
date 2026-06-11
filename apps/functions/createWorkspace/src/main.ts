// Appwrite Function entrypoint (Node 20). Resolves the authenticated caller
// from the Appwrite-provided header and delegates to the pure core.
import { createLogger } from "@merism/observability";
import { createWorkspace } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string; headers?: Record<string, string> };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  const logger = createLogger("createWorkspace");
  let input: unknown = req.bodyJson;
  if (input === undefined && req.bodyRaw) {
    try {
      input = JSON.parse(req.bodyRaw);
    } catch {
      input = undefined;
    }
  }
  const callerUserId = req.headers?.["x-appwrite-user-id"] ?? null;

  try {
    const result = await createWorkspace(input, createRealDeps(callerUserId));
    if (result.status === 200) {
      logger.info("workspace created", { workspaceId: result.body.workspaceId });
    } else {
      logger.warn("createWorkspace rejected", { status: result.status, error: result.body.error });
    }
    log(`createWorkspace -> ${result.status}`);
    return res.json(result.body, result.status);
  } catch (e) {
    error(`createWorkspace failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("unhandled error");
    return res.json({ error: "internal_error", traceId: logger.traceId }, 500);
  }
}
