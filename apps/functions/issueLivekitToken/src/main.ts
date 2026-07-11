// Appwrite Function entrypoint (Node 20 runtime).
import { maskSecret, withErrorBoundary } from "@merism/observability";
import { issueLivekitToken } from "./handler.js";
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

  // Per apps/functions/AGENTS.md:34 — every Function entry MUST go through
  // withErrorBoundary. The boundary creates a traceId-scoped logger,
  // catches any uncaught throw past this handler, logs the stack via
  // logger.error("unhandled function error", { stack }), and returns the
  // canonical { ok: false, status: 500, error: "internal_error", traceId }
  // shape — no need to hand-roll a try/catch here.
  const boundary = await withErrorBoundary("issueLivekitToken", async (logger) => {
    const result = await issueLivekitToken(input, createRealDeps());
    if (result.status === 200) {
      logger.info("token issued", {
        sessionId: result.body.sessionId,
        token: maskSecret(result.body.token), // never log full token
      });
    } else {
      logger.warn("issue rejected", { status: result.status, error: result.body.error });
    }
    log(`issueLivekitToken -> ${result.status}`);
    return result;
  });

  if (boundary.ok) {
    return res.json(boundary.data.body, boundary.data.status);
  }
  error(`issueLivekitToken unhandled (traceId=${boundary.traceId})`);
  return res.json({ error: boundary.error, traceId: boundary.traceId }, boundary.status);
}
