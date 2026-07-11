"""Qwen-VL LLM adapter (multimodal text+image, cascade ``llm=`` slot).

Qwen-VL speaks the OpenAI chat-completions protocol (with ``image_url`` content
parts), so the livekit ``openai`` plugin is reused with DashScope's
OpenAI-compatible base URL. This is the active LLM in the cascade today
(replaced DeepSeek to enable image-stimulus understanding; see ADR-0011).

Switching the LLM provider violates the default ``DeepSeek is the only LLM``
rule (``architecture.md``); see ADR-0011 for the authorising decision.

Plugin import is lazy so the package stays importable without the ``realtime``
extra (``uv sync --extra realtime``).
"""
from __future__ import annotations

from typing import Any

from agent.providers.settings import LLMSettings


def build_llm(settings: LLMSettings) -> Any:
    """Construct a livekit LLM bound to Qwen-VL via DashScope OpenAI-compat.

    Image stimuli reach the model via ``ImageContent`` parts on the
    ``ChatContext`` (see ``LiveKitQuestionTask._maybe_inject_visual_stimulus``);
    the openai plugin serializes them to the ``image_url`` content type
    Qwen-VL expects.

    Returns a ``livekit.plugins.openai.LLM`` instance. Requires the ``realtime``
    extra (``uv sync --extra realtime``).
    """
    from livekit.plugins import openai

    return openai.LLM(
        model=settings.model,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )
