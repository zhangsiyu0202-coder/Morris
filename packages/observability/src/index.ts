export * from "./logger.js";
export * from "./retry.js";

import { createLogger } from "./logger.js";

/**
 * Wrap an Appwrite Function handler so uncaught errors become a 5xx body
 * `{error, traceId}` with a stack logged (Req 6.2). `handler` returns the
 * success payload; failures are caught and shaped uniformly.
 */
export async function withErrorBoundary<T>(
  scope: string,
  handler: (log: ReturnType<typeof createLogger>) => Promise<T>,
): Promise<
  { ok: true; data: T } | { ok: false; status: number; error: string; traceId: string }
> {
  const log = createLogger(scope);
  try {
    return { ok: true, data: await handler(log) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("unhandled function error", { stack: err instanceof Error ? err.stack : undefined });
    return { ok: false, status: 500, error: "internal_error", traceId: log.traceId };
  }
}
