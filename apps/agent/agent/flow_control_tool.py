"""Gemini Live function tool used to return bounded FlowRunner decisions."""
from __future__ import annotations

from typing import Literal, Protocol

from livekit.agents import RunContext, function_tool
from livekit.agents.llm import StopResponse, ToolError


class FlowControlReceiver(Protocol):
    async def accept_flow_control(
        self,
        *,
        kind: Literal["condition", "probe_question"],
        matched: bool | None = None,
        question: str | None = None,
    ) -> bool: ...


def build_flow_control_tool(receiver: FlowControlReceiver):
    @function_tool(
        name="merism_flow_control",
        description="Return the currently requested private FlowRunner control result.",
    )
    async def merism_flow_control(
        _ctx: RunContext,
        kind: Literal["condition", "probe_question"],
        matched: bool | None = None,
        question: str | None = None,
    ) -> None:
        accepted = await receiver.accept_flow_control(
            kind=kind,
            matched=matched,
            question=question,
        )
        if not accepted:
            raise ToolError("No matching FlowRunner control request is active.")
        # The decision is consumed by FlowRunner. Returning StopResponse keeps
        # Gemini from creating a follow-up spoken reply for this private turn.
        raise StopResponse()

    return merism_flow_control
