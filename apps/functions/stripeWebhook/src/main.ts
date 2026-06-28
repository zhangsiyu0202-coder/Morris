// Appwrite Function entrypoint for Stripe webhooks. Uses the RAW body for
// signature verification (must not be re-serialized).
import { withErrorBoundary } from "@merism/observability";
import { stripeWebhook } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyRaw?: string; headers?: Record<string, string> };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  const signature = req.headers?.["stripe-signature"] ?? null;

  const boundary = await withErrorBoundary("stripeWebhook", async (logger) => {
    const result = await stripeWebhook(req.bodyRaw ?? "", signature, createRealDeps());
    if (result.status !== 200) logger.warn("stripeWebhook rejected", { status: result.status });
    log(`stripeWebhook -> ${result.status}`);
    return result;
  });

  if (boundary.ok) {
    return res.json(boundary.data.body, boundary.data.status);
  }
  error(`stripeWebhook unhandled (traceId=${boundary.traceId})`);
  return res.json({ error: boundary.error, traceId: boundary.traceId }, boundary.status);
}
