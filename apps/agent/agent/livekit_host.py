"""LiveKit + Gemini adapters for the pure declarative interview flow."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from livekit.agents import AgentSession, llm
from livekit.plugins import google

from .answer_gate import AnswerGate
from .flow import AnswerRecord, FlowState, QuestionResult
from .rpc import parse_ui_submission
from .stimulus import GeminiLiveStimulusSender

SUBMIT_ANSWER_RPC_METHOD = "merism.submit_answer"
INTERVIEW_STATE_ATTRIBUTE = "merism.interviewState"


def _parse_yes_no(text: str, *, default: bool) -> bool:
    upper = text.strip().upper()
    if upper.startswith("YES") or " 是" in text or "满足" in text:
        return True
    if upper.startswith("NO") or any(token in text for token in ("不", "没", "否")):
        return False
    return default


class LiveKitFlowHost:
    def __init__(self, *, room: Any, session: AgentSession, api_key: str, flow_model: str, runtime_study: dict[str, Any] | None, stimulus_sender: GeminiLiveStimulusSender | None = None) -> None:
        self._room = room
        self._session = session
        self._gate = AnswerGate()
        self._answer_event = asyncio.Event()
        self._text = google.LLM(model=flow_model, api_key=api_key, temperature=0, max_output_tokens=64)
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
            question = (await self._generate(
                "Generate one concise follow-up interview question only.\n"
                f"Researcher objective: {instruction}\nQuestion: {source.question_content}\n"
                f"Answer: {source.respondent_answer}\nPrior rounds: {json.dumps(rounds, ensure_ascii=False)}"
            )).strip()
            if not question:
                break
            answer = await self._speak_and_wait(
                question_id=f"{step['stepId']}:probe",
                instructions=f"Ask this follow-up question exactly once, then wait silently: {question}",
            )
            rounds.append({"probeQuestion": question, "respondentAnswer": answer.respondent_answer})
            if index + 1 >= int(step.get("maxRounds", 3)) or _respondent_has_no_more(answer.respondent_answer):
                break
            judgment = await self._generate(
                "Return YES only if the probing objective has been fully met; otherwise NO only.\n"
                f"Objective: {instruction}\nAnswer: {source.respondent_answer}\nRounds: {json.dumps(rounds, ensure_ascii=False)}"
            )
            if _parse_yes_no(judgment, default=True):
                break
        return rounds

    async def evaluate_condition(self, condition: str, answer: AnswerRecord, _state: FlowState) -> bool:
        value = await self._generate(
            "Return YES only when the answer directly and clearly satisfies the condition; otherwise NO only.\n"
            f"Condition: {condition}\nQuestion: {answer.question_content}\nAnswer: {answer.respondent_answer}"
        )
        return _parse_yes_no(value, default=False)

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

    async def _generate(self, prompt: str) -> str:
        ctx = llm.ChatContext.empty()
        ctx.add_message(role="user", content=prompt)
        return "".join([chunk async for chunk in self._text.chat(chat_ctx=ctx).to_str_iterable()])


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
