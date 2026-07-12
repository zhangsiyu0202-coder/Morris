import { createLogger, type LogFields, type Logger } from "@merism/observability";

/**
 * Session-scoped logger for the Mastra LiveKit worker.
 *
 * Every interview session gets its own logger with `traceId = sessionId`
 * (deterministic; joins to any log line the Function boundary or persistence
 * layer emits for the same session). All emissions carry `scope: "agent.*"`
 * per `.kiro/steering/errors-and-observability.md § Logger contract`. This is
 * the TS-side counterpart to `apps/agent/agent/logging.py::create_logger`
 * which ADR-0013 deletes with the Python worker.
 *
 * The `@merism/observability` logger has no `.child()` — it takes `traceId`
 * as a constructor arg. We wrap it so every emission merges the session
 * bindings (sessionId / surveyId) into `fields`.
 */
export interface SessionLogger extends Logger {
  readonly sessionId?: string;
  readonly surveyId?: string;
}

export function createSessionLogger(
  scope: `agent.${string}`,
  bindings: { sessionId?: string; surveyId?: string; traceId?: string } = {},
): SessionLogger {
  const traceId = bindings.traceId ?? bindings.sessionId;
  const base = createLogger(scope, traceId);
  const merge = (fields: LogFields = {}): LogFields => ({
    ...(bindings.sessionId ? { sessionId: bindings.sessionId } : {}),
    ...(bindings.surveyId ? { surveyId: bindings.surveyId } : {}),
    ...fields,
  });
  return {
    traceId: base.traceId,
    sessionId: bindings.sessionId,
    surveyId: bindings.surveyId,
    info: (m, f) => base.info(m, merge(f)),
    warn: (m, f) => base.warn(m, merge(f)),
    error: (m, f) => base.error(m, merge(f)),
  };
}
