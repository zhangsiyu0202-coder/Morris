import asyncio

import pytest
from livekit.agents.llm import StopResponse, ToolError

from agent.flow_control_tool import build_flow_control_tool


class _Receiver:
    def __init__(self, accepted: bool) -> None:
        self.accepted = accepted
        self.calls: list[dict[str, object]] = []

    async def accept_flow_control(self, **kwargs: object) -> bool:
        self.calls.append(kwargs)
        return self.accepted


def test_flow_control_tool_hands_the_result_to_the_active_host_without_replying() -> None:
    async def run() -> None:
        receiver = _Receiver(accepted=True)
        tool = build_flow_control_tool(receiver)

        assert tool.id == "merism_flow_control"
        with pytest.raises(StopResponse):
            await tool(None, kind="condition", matched=True)
        assert receiver.calls == [{"kind": "condition", "matched": True, "question": None}]

    asyncio.run(run())


def test_flow_control_tool_rejects_stale_or_wrong_kind_calls() -> None:
    async def run() -> None:
        tool = build_flow_control_tool(_Receiver(accepted=False))
        with pytest.raises(ToolError, match="No matching FlowRunner control request is active"):
            await tool(None, kind="probe_question", question="Could you say more?")

    asyncio.run(run())
