"""In-session control handoff for bounded FlowRunner model decisions."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal

FlowControlKind = Literal["condition", "probe_question"]


@dataclass(frozen=True)
class FlowControlResult:
    kind: FlowControlKind
    matched: bool | None = None
    question: str | None = None


class FlowControlGate:
    """Accept exactly one typed result for the currently requested decision."""

    def __init__(self) -> None:
        self._pending: tuple[FlowControlKind, asyncio.Future[FlowControlResult]] | None = None

    def begin(self, kind: FlowControlKind) -> asyncio.Future[FlowControlResult]:
        if self._pending is not None:
            raise RuntimeError("flow control request already pending")
        future: asyncio.Future[FlowControlResult] = asyncio.get_running_loop().create_future()
        self._pending = (kind, future)
        return future

    def clear(self, future: asyncio.Future[FlowControlResult]) -> None:
        if self._pending is not None and self._pending[1] is future:
            self._pending = None

    def accept(
        self,
        *,
        kind: FlowControlKind,
        matched: bool | None = None,
        question: str | None = None,
    ) -> bool:
        pending = self._pending
        if pending is None or pending[0] != kind or pending[1].done():
            return False
        if kind == "condition" and not isinstance(matched, bool):
            return False
        if kind == "probe_question" and not isinstance(question, str):
            return False
        normalized_question = question.strip() if isinstance(question, str) else None
        if kind == "probe_question" and not normalized_question:
            return False
        pending[1].set_result(
            FlowControlResult(kind=kind, matched=matched, question=normalized_question)
        )
        return True
