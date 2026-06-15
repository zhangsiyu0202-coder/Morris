"""Structured JSON logging for the Agent Worker.

Mirrors packages/observability createLogger (TS). Emits one JSON object per line:
{timestamp, level, sessionId?, traceId, message, ...}. Secrets must be masked
before being passed in (see mask_secret).
"""
from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from typing import Any


def mask_secret(value: str, visible: int = 4) -> str:
    if not value:
        return ""
    return value[:visible] + "***"


class Logger:
    def __init__(self, scope: str, trace_id: str | None = None) -> None:
        self.scope = scope
        self.trace_id = trace_id or str(uuid.uuid4())

    def _emit(self, level: str, message: str, **fields: Any) -> None:
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "traceId": self.trace_id,
            "scope": self.scope,
            "message": message,
            **fields,
        }
        sys.stdout.write(json.dumps(record, default=str) + "\n")
        sys.stdout.flush()

    def info(self, message: str, **fields: Any) -> None:
        self._emit("info", message, **fields)

    def warn(self, message: str, **fields: Any) -> None:
        self._emit("warn", message, **fields)

    def error(self, message: str, **fields: Any) -> None:
        self._emit("error", message, **fields)


def create_logger(scope: str, trace_id: str | None = None) -> Logger:
    return Logger(scope, trace_id)
