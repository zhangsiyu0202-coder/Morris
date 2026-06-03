"""Retry + backoff wrapper for external provider calls (LLM/STT/TTS).

Mirrors packages/observability withRetry (TS). Retries TransientProviderError
with exponential backoff up to max_attempts; PermanentProviderError is never
retried.
"""
from __future__ import annotations

import time
from typing import Callable, TypeVar

T = TypeVar("T")


class TransientProviderError(Exception):
    """Retryable provider failure (rate limit, timeout, transient 5xx)."""


class PermanentProviderError(Exception):
    """Non-retryable provider failure (auth failure, hard limit, bad request)."""


def with_retry(
    fn: Callable[[], T],
    *,
    max_attempts: int = 3,
    base_delay: float = 0.2,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    attempt = 0
    while True:
        try:
            return fn()
        except PermanentProviderError:
            raise
        except TransientProviderError:
            attempt += 1
            if attempt >= max_attempts:
                raise
            sleep(base_delay * (2 ** (attempt - 1)))
