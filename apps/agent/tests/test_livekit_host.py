import asyncio
import json

from agent.answer_gate import AnswerGate
from agent.flow_control import FlowControlGate
from agent.flow import AnswerRecord
from agent.livekit_host import LiveKitFlowHost


class _Session:
    def __init__(self) -> None:
        self.interrupted = False

    async def interrupt(self) -> None:
        self.interrupted = True


class _ControlSession:
    def __init__(self) -> None:
        self.instructions: list[str] = []

    def generate_reply(self, *, instructions: str, allow_interruptions: bool) -> None:
        assert allow_interruptions is True
        self.instructions.append(instructions)


class _Invocation:
    payload = json.dumps(
        {
            "answer": {
                "questionId": "q1",
                "sectionId": "s1",
                "questionType": "open_ended",
                "source": "ui",
                "text": "Answer from the UI",
            }
        }
    )


def test_ui_answer_interrupts_pending_gemini_speech_before_advancing_flow() -> None:
    async def run() -> None:
        host = object.__new__(LiveKitFlowHost)
        host._gate = AnswerGate()
        host._gate.begin("q1")
        host._answer_event = asyncio.Event()
        host._session = _Session()

        response = json.loads(await host._on_submit_answer(_Invocation()))

        assert response["accepted"] is True
        assert host._answer_event.is_set()
        assert host._session.interrupted is True

    asyncio.run(run())


def test_question_image_is_sent_to_gemini_before_the_question_is_generated() -> None:
    class _StimulusSender:
        def __init__(self, events: list[str]) -> None:
            self._events = events

        async def send(self, stimulus: dict[str, object]) -> None:
            assert stimulus["id"] == "image-1"
            self._events.append("stimulus")

    async def run() -> None:
        events: list[str] = []
        host = object.__new__(LiveKitFlowHost)
        host._stimulus_sender = _StimulusSender(events)

        async def speak_and_wait(**kwargs: object):
            assert "researcher-provided image" in str(kwargs["instructions"])
            events.append("question")
            return object()

        host._speak_and_wait = speak_and_wait
        result = await host.ask_question(
            {
                "stepId": "q1",
                "content": "What do you think of this image?",
                "stimulus": {"id": "image-1", "type": "image", "url": "https://example.invalid/image.png"},
            },
            object(),
        )

        assert result is not None
        assert events == ["stimulus", "question"]

    asyncio.run(run())


def test_condition_waits_for_the_matching_in_session_function_result() -> None:
    async def run() -> None:
        host = object.__new__(LiveKitFlowHost)
        host._flow_control = FlowControlGate()
        host._flow_control_lock = asyncio.Lock()
        host._session = _ControlSession()

        pending = asyncio.create_task(
            host.evaluate_condition(
                "is eligible",
                AnswerRecord(
                    question_content="Question",
                    respondent_answer="Answer",
                    selected_option_ids=[],
                ),
                object(),
            )
        )
        await asyncio.sleep(0)

        assert await host.accept_flow_control(kind="probe_question", question="Why?") is False
        assert await host.accept_flow_control(kind="condition", matched=True) is True

        assert await pending is True
        assert len(host._session.instructions) == 1
        assert "merism_flow_control" in host._session.instructions[0]

    asyncio.run(run())
