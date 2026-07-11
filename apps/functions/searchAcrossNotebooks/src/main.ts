// Appwrite Function entrypoint (Node 20 runtime).
import { withErrorBoundary } from "@merism/observability";
import { searchAcrossNotebooks } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyJson?: unknown; bodyRaw?: string };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
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

  const boundary = await withErrorBoundary("searchAcrossNotebooks", async (logger) => {
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
    return result;
  });

  if (boundary.ok) {
    return res.json(boundary.data.body, boundary.data.status);
  }
  error(`searchAcrossNotebooks unhandled (traceId=${boundary.traceId})`);
  return res.json({ error: boundary.error, traceId: boundary.traceId }, boundary.status);
}
