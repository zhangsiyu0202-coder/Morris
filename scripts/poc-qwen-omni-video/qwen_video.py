"""Thin wrapper over the DashScope SDK for Qwen-Omni video analysis.

POC for the "wrap the SDK, run this Function in Python" decision (ADR draft D1,
option 1). This module is the seam: it hides the dashscope SDK behind a narrow
interface and mirrors the apps/agent observability shape (create_logger,
Transient/PermanentProviderError) so it satisfies errors-and-observability
steering once promoted out of the POC.

What the SDK gives us for free (verified against oss_utils source + live runs):
  - local file:// -> temporary oss:// upload (no self-hosted OSS, no public
    Storage exposure, no recording public-URL window).
  - automatic X-DashScope-OssResourceResolve header on the model call.

The wrapper's job: classify failures into Transient vs Permanent so a caller's
with_retry can act, mask the key in logs, and expose ONE function:
    analyze_video(local_path, prompt, ...) -> VideoAnalysisResult

It deliberately does NOT do segmentation, consolidation, or persistence — those
stay in the orchestrator, exactly like the existing Gemini split.
"""
from __future__ import annotations

import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

# --- minimal local copies of the agent observability primitives -------------
# (POC runs standalone; when promoted, import from agent.logging / agent.retry.)


def mask_secret(value: str, visible: int = 4) -> str:
    if not value:
        return ""
    return value[:visible] + "***"


class Logger:
    def __init__(self, scope: str, trace_id: str | None = None) -> None:
        self.scope = scope
        self.trace_id = trace_id or str(uuid.uuid4())

    def _emit(self, level: str, message: str, **fields: Any) -> None:
        import json

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


class TransientProviderError(Exception):
    """Retryable: rate limit, timeout, transient 5xx, oss fetch timeout."""


class PermanentProviderError(Exception):
    """Non-retryable: auth failure, bad request, file too large, no access."""


def with_retry(
    fn: Callable[[], Any],
    *,
    max_attempts: int = 3,
    base_delay: float = 0.5,
    sleep: Callable[[float], None] = time.sleep,
    logger: Logger | None = None,
) -> Any:
    attempt = 0
    while True:
        try:
            return fn()
        except PermanentProviderError:
            raise
        except TransientProviderError as e:
            attempt += 1
            if logger:
                logger.warn("qwen_video.transient_retry", attempt=attempt, reason=str(e)[:200])
            if attempt >= max_attempts:
                raise
            sleep(base_delay * (2 ** (attempt - 1)))


# --- wrapper config + result -------------------------------------------------

DEFAULT_MODEL = "qwen3.5-omni-plus"
# Models that route through the omni pipeline require streaming + text-only out
# on the compatible/native endpoints (verified live: non-stream 400s).
_OMNI_MARKER = "omni"


@dataclass
class QwenVideoConfig:
    api_key: str
    model: str = DEFAULT_MODEL
    # Hard ceiling mirroring DashScope's documented 2GB/1h limit; reject early.
    max_bytes: int = 2 * 1024 * 1024 * 1024


@dataclass
class VideoAnalysisResult:
    text: str
    model: str
    oss_url: str
    generated_at: str
    char_count: int = field(init=False)

    def __post_init__(self) -> None:
        self.char_count = len(self.text)


# --- error classification ----------------------------------------------------


def _classify(exc: Exception) -> Exception:
    """Map raw SDK/HTTP failures into Transient vs Permanent."""
    msg = str(exc).lower()
    # Permanent: auth, access, malformed, oversize, unsupported.
    permanent_markers = (
        "access denied",
        "access_denied",
        "invalid api",
        "invalid_api_key",
        "unauthorized",
        "invalid_request",
        "invalidparameter",
        "file too large",
        "unsupported",
        "not exists",
    )
    if any(m in msg for m in permanent_markers):
        return PermanentProviderError(str(exc))
    # Transient: throttling, timeout, 5xx, oss fetch failures.
    transient_markers = (
        "throttl",
        "rate limit",
        "rate_limit",
        "timeout",
        "timed out",
        "download",
        "temporar",
        "service unavailable",
        "internal error",
        "429",
        "500",
        "502",
        "503",
        "504",
    )
    if any(m in msg for m in transient_markers):
        return TransientProviderError(str(exc))
    # Unknown -> treat as transient once; with_retry bounds total attempts.
    return TransientProviderError(str(exc))


# --- the narrow public surface ----------------------------------------------


def upload_local_video(config: QwenVideoConfig, local_path: str, logger: Logger) -> str:
    """local file -> oss:// via the SDK's documented helper. Returns oss:// url."""
    abs_path = os.path.abspath(local_path)
    if not os.path.isfile(abs_path):
        raise PermanentProviderError(f"file not exists: {abs_path}")
    size = os.path.getsize(abs_path)
    if size == 0:
        raise PermanentProviderError("video bytes are empty")
    if size > config.max_bytes:
        raise PermanentProviderError(f"video exceeds max_bytes ({config.max_bytes})")

    from dashscope.utils.oss_utils import upload_file

    logger.info("qwen_video.upload.start", bytes=size, model=config.model)
    try:
        oss_url = upload_file(
            model=config.model,
            upload_path=f"file://{abs_path}",
            api_key=config.api_key,
        )
    except Exception as exc:  # noqa: BLE001 - classify then re-raise typed
        raise _classify(exc) from exc

    if not oss_url or not str(oss_url).startswith("oss://"):
        # No oss:// means the upload silently failed — treat as transient retry.
        raise TransientProviderError(f"upload returned non-oss url: {oss_url!r}")
    logger.info("qwen_video.upload.ok", oss_scheme=True)
    return oss_url


def analyze_oss_video(
    config: QwenVideoConfig, oss_url: str, prompt: str, logger: Logger
) -> str:
    """Feed an oss:// url to the model via the OpenAI-compatible endpoint.

    Uses the OpenAI SDK (not dashscope) for the chat call so this maps 1:1 to a
    future TS @ai-sdk call; only the upload step needs the dashscope SDK.
    """
    from openai import OpenAI

    base_url = os.environ.get(
        "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    client = OpenAI(api_key=config.api_key, base_url=base_url)
    is_omni = _OMNI_MARKER in config.model

    logger.info("qwen_video.analyze.start", model=config.model, omni=is_omni)
    try:
        kwargs: dict[str, Any] = dict(
            model=config.model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "video_url", "video_url": {"url": oss_url}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            extra_headers={"X-DashScope-OssResourceResolve": "enable"},
        )
        if is_omni:
            kwargs["stream"] = True
            kwargs["modalities"] = ["text"]
            resp = client.chat.completions.create(**kwargs)
            parts = [
                ch.choices[0].delta.content
                for ch in resp
                if ch.choices and ch.choices[0].delta.content
            ]
            text = "".join(parts)
        else:
            resp = client.chat.completions.create(**kwargs)
            text = resp.choices[0].message.content or ""
    except Exception as exc:  # noqa: BLE001 - classify then re-raise typed
        raise _classify(exc) from exc

    if not text.strip():
        raise TransientProviderError("model returned empty text")
    logger.info("qwen_video.analyze.ok", chars=len(text))
    return text


def analyze_video(
    config: QwenVideoConfig,
    local_path: str,
    prompt: str,
    *,
    logger: Logger | None = None,
) -> VideoAnalysisResult:
    """End-to-end: local video -> oss:// -> analysis text. Retries transient steps."""
    log = logger or Logger("function.analyzeSessionVisual.qwen", None)
    log.info("qwen_video.begin", path=local_path, key=mask_secret(config.api_key))

    oss_url = with_retry(
        lambda: upload_local_video(config, local_path, log),
        max_attempts=3,
        logger=log,
    )
    text = with_retry(
        lambda: analyze_oss_video(config, oss_url, prompt, log),
        max_attempts=3,
        logger=log,
    )
    result = VideoAnalysisResult(
        text=text,
        model=config.model,
        oss_url=oss_url,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    log.info("qwen_video.done", chars=result.char_count)
    return result


def config_from_env() -> QwenVideoConfig:
    api_key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("QWEN_API_KEY")
    if not api_key or api_key == "changeme":
        raise PermanentProviderError("DASHSCOPE_API_KEY / QWEN_API_KEY not set")
    return QwenVideoConfig(
        api_key=api_key,
        model=os.environ.get("QWEN_VISUAL_MODEL", DEFAULT_MODEL),
    )
