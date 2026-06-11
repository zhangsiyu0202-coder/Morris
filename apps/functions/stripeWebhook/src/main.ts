// Appwrite Function entrypoint for Stripe webhooks. Uses the RAW body for
// signature verification (must not be re-serialized).
import { createLogger } from "@merism/observability";
import { stripeWebhook } from "./handler.js";
import { createRealDeps } from "./deps.js";

type Ctx = {
  req: { bodyRaw?: string; headers?: Record<string, string> };
  res: { json: (data: unknown, status?: number) => unknown };
  log: (msg: string) => void;
  error: (msg: string) => void;
};

export default async function main({ req, res, log, error }: Ctx) {
  const logger = createLogger("stripeWebhook");
  const signature = req.headers?.["stripe-signature"] ?? null;
  try {
    const result = await stripeWebhook(req.bodyRaw ?? "", signature, createRealDeps());
    if (result.status !== 200) logger.warn("stripeWebhook rejected", { status: result.status });
    log(`stripeWebhook -> ${result.status}`);
    return res.json(result.body, result.status);
  } catch (e) {
    error(`stripeWebhook failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("unhandled error");
    return res.json({ error: "internal_error", traceId: logger.traceId }, 500);
  }
}
