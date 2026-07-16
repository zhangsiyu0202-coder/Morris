"""LiveKit + Gemini adapters for the pure declarative interview flow."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from livekit.agents import AgentSession

from .answer_gate import AnswerGate
from .flow import AnswerRecord, FlowState, QuestionResult
from .flow_control import FlowControlGate, FlowControlKind
from .rpc import parse_ui_submission
from .stimulus import GeminiLiveStimulusSender

SUBMIT_ANSWER_RPC_METHOD = "merism.submit_answer"
INTERVIEW_STATE_ATTRIBUTE = "merism.interviewState"


class LiveKitFlowHost:
    def __init__(self, *, room: Any, session: AgentSession, runtime_study: dict[str, Any] | None, stimulus_sender: GeminiLiveStimulusSender | None = None) -> None:
        self._room = room
        self._session = session
        self._gate = AnswerGate()
        self._answer_event = asyncio.Event()
        self._flow_control = FlowControlGate()
        self._flow_control_lock = asyncio.Lock()
        self._questions = _index_runtime_questions(runtime_study)
        self._stimulus_sender = stimulus_sender
        self._started_at = time.time()
        self._transcript_segments: list[dict[str, Any]] = []
        self._seen_transcript_ids: set[str] = set()
        session.on("user_input_transcribed", self._on_user_input_transcribed)
        room.local_participant.register_rpc_method(SUBMIT_ANSWER_RPC_METHOD, self._on_submit_answer)

    @property
    def current_question_id(self) -> str | None:
        return self._gate.current_question_id

    @property
    def has_active_task(self) -> bool:
        return self._gate.active

    @property
    def transcript(self) -> dict[str, Any] | None:
        return {"language": "zh", "segments": list(self._transcript_segments)} if self._transcript_segments else None

    async def on_step_enter(self, _step_id: str, _state: FlowState) -> None:
        return

    async def ask_question(self, step: dict[str, Any], _state: FlowState) -> QuestionResult:
        stimulus = step.get("stimulus")
        if self._stimulus_sender is not None:
            await self._stimulus_sender.send(stimulus if isinstance(stimulus, dict) else None)
        stimulus_instruction = ""
        if isinstance(stimulus, dict) and stimulus.get("type") == "image":
            stimulus_instruction = (
                " A researcher-provided image stimulus was sent immediately before this request. "
                "It is stage material, not respondent speech; use only what is visibly shown in it."
            )
        return await self._speak_and_wait(
            question_id=str(step["stepId"]),
            instructions="Ask this interview question naturally exactly once, then wait silently for the answer. "
            f"Question: {step['content']}{stimulus_instruction}",
        )

    async def run_probe(self, step: dict[str, Any], state: FlowState) -> list[dict[str, str]]:
        instruction = str(step.get("instruction", "")).strip()
        source = state.answers.get(str(step.get("forQuestionStepId", "")))
        if not instruction or source is None:
            return []
        rounds: list[dict[str, str]] = []
        for index in range(int(step.get("maxRounds", 3))):
            question = await self._request_probe_question(
                "Use merism_flow_control exactly once with kind=probe_question and a concise follow-up question. "
                "Do not speak or write a respondent-facing reply.\n"
                f"Researcher objective: {instruction}\nQuestion: {source.question_content}\n"
                f"Answer: {source.respondent_answer}\nPrior rounds: {json.dumps(rounds, ensure_ascii=False)}"
            )
            if not question:
                break
            answer = await self._speak_and_wait(
                question_id=f"{step['stepId']}:probe",
                instructions=f"Ask this follow-up question exactly once, then wait silently: {question}",
            )
            rounds.append({"probeQuestion": question, "respondentAnswer": answer.respondent_answer})
            if index + 1 >= int(step.get("maxRounds", 3)) or _respondent_has_no_more(answer.respondent_answer):
                break
            if await self._request_condition(
                "Use merism_flow_control exactly once with kind=condition and matched=true only if "
                "the probing objective has been fully met; otherwise matched=false. "
                "Do not speak or write a respondent-facing reply.\n"
                f"Objective: {instruction}\nAnswer: {source.respondent_answer}\nRounds: {json.dumps(rounds, ensure_ascii=False)}"
            ):
                break
        return rounds

    async def evaluate_condition(self, condition: str, answer: AnswerRecord, _state: FlowState) -> bool:
        return await self._request_condition(
            "Use merism_flow_control exactly once with kind=condition and matched=true only when "
            "the answer directly and clearly satisfies the condition; otherwise matched=false. "
            "Do not speak or write a respondent-facing reply.\n"
            f"Condition: {condition}\nQuestion: {answer.question_content}\nAnswer: {answer.respondent_answer}"
        )

    async def on_flow_completed(self, _state: FlowState) -> None:
        self._gate.clear()
        await self._publish_state("completed")

    async def _speak_and_wait(self, *, question_id: str, instructions: str) -> QuestionResult:
        self._gate.begin(question_id)
        self._answer_event.clear()
        await self._publish_state("collecting", question_id)
        self._session.generate_reply(instructions=instructions, allow_interruptions=True)
        try:
            await asyncio.wait_for(self._answer_event.wait(), timeout=300)
        except asyncio.TimeoutError:
            return QuestionResult("")
        result = self._gate.result or QuestionResult("")
        self._gate.clear()
        return result

    def _on_user_input_transcribed(self, event: Any) -> None:
        if not getattr(event, "is_final", False):
            return
        text = str(getattr(event, "transcript", "")).strip()
        if not text:
            return
        item_id = getattr(event, "item_id", None)
        if item_id and item_id in self._seen_transcript_ids:
            return
        if item_id:
            self._seen_transcript_ids.add(item_id)
        offset_ms = max(0, int((time.time() - self._started_at) * 1000))
        self._transcript_segments.append({"speaker": "interviewee", "startMs": offset_ms, "endMs": offset_ms, "text": text})
        if self._gate.accept_voice(text):
            self._answer_event.set()

    async def _on_submit_answer(self, invocation: Any) -> str:
        parsed = parse_ui_submission(invocation.payload)
        accepted = bool(parsed) and self._gate.accept_ui(parsed[0], parsed[1].respondent_answer, parsed[1].selected_option_ids)
        if accepted:
            try:
                await self._session.interrupt()
            except RuntimeError:
                # A room shutdown can race a final UI RPC. The accepted answer
                # is still valid; there is simply no remaining speech to stop.
                pass
            self._answer_event.set()
        return json.dumps({"ok": True, "accepted": accepted, "completed": False, "nextQuestionId": self.current_question_id})

    async def _publish_state(self, status: str, question_id: str | None = None) -> None:
        payload: dict[str, Any] = {"status": status, "updatedAt": _now_iso()}
        if question_id:
            payload["currentQuestionId"] = question_id
            question = self._questions.get(question_id)
            if question:
                payload["currentQuestion"] = question
                if question.get("sectionId"):
                    payload["currentSectionId"] = question["sectionId"]
        await self._room.local_participant.set_attributes({INTERVIEW_STATE_ATTRIBUTE: json.dumps(payload)})

    async def accept_flow_control(
        self,
        *,
        kind: FlowControlKind,
        matched: bool | None = None,
        question: str | None = None,
    ) -> bool:
        return self._flow_control.accept(kind=kind, matched=matched, question=question)

    async def _request_condition(self, instructions: str) -> bool:
        result = await self._request_flow_control("condition", instructions)
        assert result.matched is not None
        return result.matched

    async def _request_probe_question(self, instructions: str) -> str:
        result = await self._request_flow_control("probe_question", instructions)
        assert result.question is not None
        return result.question

    async def _request_flow_control(self, kind: FlowControlKind, instructions: str):
        async with self._flow_control_lock:
            future = self._flow_control.begin(kind)
            # Gemini Live owns server-side turn detection and rejects
            # allow_interruptions=False. The control tool raises StopResponse,
            # so this private turn still cannot produce a follow-up reply.
            self._session.generate_reply(instructions=instructions, allow_interruptions=True)
            try:
                return await asyncio.wait_for(future, timeout=30)
            finally:
                self._flow_control.clear(future)


def _index_runtime_questions(study: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not study:
        return {}
    return {str(question["questionId"]): question for section in study.get("sections", []) for question in section.get("questions", []) if question.get("questionId")}


def _respondent_has_no_more(text: str) -> bool:
    normalized = text.lower()
    return any(token in normalized for token in ("没有更多", "没什么补充", "就这些", "没了", "nothing else", "no more", "that's all"))


def _now_iso() -> str:
    from datetime import UTC, datetime
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
