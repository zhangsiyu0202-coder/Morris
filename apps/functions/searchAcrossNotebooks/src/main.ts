// Appwrite Function entrypoint (Node 20 runtime).
import { createLogger } from "@merism/observability";
import { searchAcrossNotebooks } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  const logger = createLogger("searchAcrossNotebooks");
  let input: unknown = req.bodyJson;
  if (input === undefined && req.bodyRaw) {
    try {
      input = JSON.parse(req.bodyRaw);
    } catch {
      input = undefined;
    }
  }

  try {
    const result = await searchAcrossNotebooks(input, createRealDeps());
    if (result.status === 200) {
      logger.info("notebooks searched", {
        matchCount: result.body.matches.length,
        fallback: result.body.fallback ?? "none",
      });
    } else {
      logger.warn("search rejected", { status: result.status, error: result.body.error });
    }
    log(`searchAcrossNotebooks -> ${result.status}`);
    return res.json(result.body, result.status);
  } catch (e) {
    error(`searchAcrossNotebooks failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("unhandled error");
    return res.json({ error: "internal_error", traceId: logger.traceId }, 500);
  }
}
