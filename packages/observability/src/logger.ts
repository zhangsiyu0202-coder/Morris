// Unified log format (Req 6.1): {timestamp, level, sessionId?, traceId, message, ...}
// Mirrors apps/agent/agent/logging.py.
import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  sessionId?: string;
  [key: string]: unknown;
}

export function maskSecret(value: string | undefined, visible = 4): string {
  if (!value) return "";
  return value.slice(0, visible) + "***";
}

export interface Logger {
  traceId: string;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createLogger(scope: string, traceId: string = randomUUID()): Logger {
  const emit = (level: LogLevel, message: string, fields: LogFields = {}) => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      traceId,
      scope,
      message,
      ...fields,
    };
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else console.log(line);
  };
  return {
    traceId,
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
