"""Shared observability primitives for Python Functions and the Agent Worker.

Mirrors @merism/observability (TS). Provides structured JSON logging,
secret masking, and provider error classification with retry.
"""
from __future__ import annotations

import json
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

T = TypeVar("T")


# ── Secret masking ────────────────────────────────────────────────

def mask_secret(value: str, visible: int = 4) -> str:
    if not value:
        return ""
    return value[:visible] + "***"


# ── Logger ─────────────────────────────────────────────────────────

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

    def debug(self, message: str, **fields: Any) -> None:
        self._emit("debug", message, **fields)


def create_logger(scope: str, trace_id: str | None = None) -> Logger:
    return Logger(scope, trace_id)


# ── Provider errors ────────────────────────────────────────────────

class TransientProviderError(Exception):
    """Retryable provider failure (rate limit, timeout, transient 5xx)."""


class PermanentProviderError(Exception):
    """Non-retryable provider failure (auth failure, hard limit, bad request)."""


# ── Retry ──────────────────────────────────────────────────────────

def with_retry(
    fn: Callable[[], T],
    *,
    max_attempts: int = 3,
    base_delay: float = 0.2,
    sleep: Callable[[float], None] = time.sleep,
    logger: Any = None,
    attempt_label: str = "",
) -> T:
    attempt = 0
    while True:
        try:
            return fn()
        except PermanentProviderError:
            raise
        except TransientProviderError as e:
            attempt += 1
            if logger:
                logger.warn(
                    "with_retry.transient" if not attempt_label else f"with_retry.transient.{attempt_label}",
                    attempt=attempt,
                    reason=str(e)[:200],
                )
            if attempt >= max_attempts:
                raise
            sleep(base_delay * (2 ** (attempt - 1)))
