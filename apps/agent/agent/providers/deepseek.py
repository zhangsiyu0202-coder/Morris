"""DeepSeek LLM adapter.

DeepSeek speaks the OpenAI chat-completions protocol, so the livekit ``openai``
plugin is reused with a custom ``base_url``. The plugin import is lazy so the
package stays importable without the ``realtime`` extra.
"""
from __future__ import annotations

from typing import Any

from agent.providers.settings import LLMSettings


def build_llm(settings: LLMSettings) -> Any:
    """Construct a livekit LLM bound to DeepSeek.

    Returns a ``livekit.plugins.openai.LLM`` instance. Requires the
    ``realtime`` extra (``uv sync --extra realtime``).
    """
    from livekit.plugins import openai

    return openai.LLM(
        model=settings.model,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )
