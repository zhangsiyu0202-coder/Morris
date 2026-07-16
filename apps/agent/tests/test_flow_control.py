import asyncio

from agent.flow_control import FlowControlGate, FlowControlResult


def test_flow_control_gate_only_accepts_a_valid_result_for_the_active_request() -> None:
    async def run() -> None:
        gate = FlowControlGate()
        condition = gate.begin("condition")

        assert gate.accept(kind="probe_question", question="Why?") is False
        assert gate.accept(kind="condition", matched=None) is False
        assert gate.accept(kind="condition", matched=True) is True
        assert await condition == FlowControlResult(kind="condition", matched=True)
        gate.clear(condition)

        probe = gate.begin("probe_question")
        assert gate.accept(kind="probe_question", question="   ") is False
        assert gate.accept(kind="probe_question", question="Could you elaborate?") is True
        assert probe.result().question == "Could you elaborate?"

    asyncio.run(run())


def test_flow_control_gate_rejects_a_second_pending_request() -> None:
    async def run() -> None:
        gate = FlowControlGate()
        gate.begin("condition")
        try:
            gate.begin("probe_question")
        except RuntimeError as error:
            assert str(error) == "flow control request already pending"
        else:
            raise AssertionError("concurrent control requests must not share a result")

    asyncio.run(run())
