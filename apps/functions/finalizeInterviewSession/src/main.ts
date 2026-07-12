// Appwrite Function entrypoint (Node 20 runtime).
import { withErrorBoundary } from "@merism/observability";
import { finalizeInterviewSession } from "./handler.js";
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

  const boundary = await withErrorBoundary("finalizeInterviewSession", async (logger) => {
    const result = await finalizeInterviewSession(input, createRealDeps());
    if (result.status === 200) {
      logger.info("session finalized", {
        sessionId: result.body.sessionId,
        terminalStatus: result.body.terminalStatus,
        transcriptPersisted: result.body.transcriptPersisted,
        analysisTriggered: result.body.analysisTriggered,
      });
    } else {
      logger.warn("finalize rejected", { status: result.status, error: result.body.error });
    }
    log(`finalizeInterviewSession -> ${result.status}`);
    return result;
  });

  if (boundary.ok) {
    return res.json(boundary.data.body, boundary.data.status);
  }
  error(`finalizeInterviewSession unhandled (traceId=${boundary.traceId})`);
  return res.json({ error: boundary.error, traceId: boundary.traceId }, boundary.status);
}
