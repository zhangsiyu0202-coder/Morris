"""Generic question task for a configured interview question."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from agent.contracts import (
    InterviewAnswerPayload,
    ProbeResult,
    ProbeRound,
    QuestionTaskConfig,
    QuestionTaskResult,
)
from agent.interview.workflow import format_ui_answer


def build_question_instructions(question: QuestionTaskConfig) -> str:
    probe = question.probeConfig
    probe_text = ""
    if probe is not None:
        guidance = probe.instruction.strip() or "（无特定指引，自行判断如何深入。）"
        probe_text = f"""

Probing (this question is always probed):
- Probe level: {probe.level}
- Probe guidance: {guidance}
- Maximum probe rounds: {probe.maxRounds}
- You MUST ask at least one probe before finishing this question — never jump
  straight to the next question. That feels robotic and loses the human touch.
- After each probe exchange, call record_probe_round with the probe question and
  the respondent's answer to it.
- You MAY stop probing early once you feel the answer is fully explored — you do
  not have to use all {probe.maxRounds} rounds.
- You may never exceed {probe.maxRounds} probe rounds. Once you reach the limit,
  finish the question.
- When you are done, call complete_question with the consolidated answer to the
  main question.
"""

    options_text = ""
    if question.options:
        rendered = "\n".join(f"  - {option}" for option in question.options)
        options_text = f"""

This is a {question.questionType} question with preset options. Read the options
aloud naturally as part of asking, and let the respondent choose by speaking (the
interviewee may also pick on screen). The options are:
{rendered}
"""

    stimulus_text = ""
    if question.stimulus is not None:
        stim = question.stimulus
        if stim.type == "text" and stim.text:
            stimulus_text = f"""

This question has a TEXT stimulus — the respondent can see the following content.
Reference it directly when you ask the question:
```
{stim.text}
```
"""
        elif stim.type == "image":
            stimulus_text = """

This question has an IMAGE stimulus. The respondent can see the image (attached
frame in this conversation). When you ask the question, weave in a reference to
what is shown — ask the respondent what they notice, think, or feel about the
image they are looking at.
"""
        elif stim.type == "video":
            stimulus_text = """

This question has a VIDEO stimulus. The video frame is NOT attached to this
conversation — you cannot see it. Wait for the respondent to react or describe
what they saw, then probe based on their description. Do not claim or pretend to
see the video.
"""

    return f"""
You are conducting one configured question inside a qualitative voice interview.

Question type: {question.questionType}
Question content: {question.questionContent}
{options_text}{stimulus_text}
Ask the question naturally and keep the interview conversational.
{probe_text}
Do not invent fields outside the tool arguments. Do not expose internal task names.
"""


async def inject_visual_stimulus_into_chat_ctx(
    *, chat_ctx: Any, stimulus: Any, update_chat_ctx: Any
) -> None:
    """Attach an image stimulus to a LiveKit ChatContext so the multimodal LLM
    sees what the respondent is looking at (CAP-4).

    Image-type only (video frames are not extracted).  The content is sent on a
    ``user`` role (Qwen-VL vision API requirement) but explicitly labeled as
    stage context so the LLM does not mistake it for the respondent's speech.

    This is a pure-ish helper so tests can call it directly with a fake
    chat_ctx + a no-op ``update_chat_ctx`` coroutine — no AgentTask construction
    needed.
    """
    if stimulus is None or stimulus.type != "image" or not stimulus.url:
        return
    from livekit.agents.llm import ImageContent

    chat_ctx.add_message(
        role="user",
        content=[
            "[Stage context — NOT respondent speech: this is the "
            "on-screen image stimulus for the upcoming question.]",
            ImageContent(image=stimulus.url),
        ],
    )
    await update_chat_ctx(chat_ctx)


def create_question_task_class():
    from livekit.agents import AgentTask, function_tool

    class LiveKitQuestionTask(AgentTask[QuestionTaskResult]):
        def __init__(
            self,
            question: QuestionTaskConfig,
            chat_ctx=None,
            on_enter_publish: Callable[[Any], None] | None = None,
        ) -> None:
            self.question = question
            # Called with this task instance when it becomes active, so the
            # supervisor can both publish the question and hold a handle to
            # complete it externally (a UI click answer).
            self._on_enter_publish = on_enter_publish
            # First-writer-wins guard: the question can be finished either by the
            # model (complete_question) or by a UI click (complete_with_ui_answer).
            # Whichever lands first wins; the other becomes a no-op. Safe without a
            # lock because every check+complete pair below is await-free, so the
            # single-threaded event loop runs each to completion atomically.
            self._completed = False
            # Accumulates each probe exchange so we can enforce the round ceiling
            # deterministically rather than trusting the LLM to count.
            self._rounds: list[ProbeRound] = []
            super().__init__(
                instructions=build_question_instructions(question),
                chat_ctx=chat_ctx,
            )

        @property
        def _max_rounds(self) -> int:
            probe = self.question.probeConfig
            return probe.maxRounds if probe is not None else 0

        async def on_enter(self) -> None:
            # Register active + publish the current question to the room first,
            # so the interviewee portal renders its structured control before
            # the AI speaks (and so the supervisor can complete this task from a
            # UI click).
            if self._on_enter_publish is not None:
                self._on_enter_publish(self)
            await self._maybe_inject_visual_stimulus()
            await self.session.generate_reply(
                instructions=f"Ask this interview question naturally: {self.question.questionContent}"
            )

        async def _maybe_inject_visual_stimulus(self) -> None:
            await inject_visual_stimulus_into_chat_ctx(
                chat_ctx=self.chat_ctx,
                stimulus=self.question.stimulus,
                update_chat_ctx=self.update_chat_ctx,
            )

        def complete_with_ui_answer(self, answer: InterviewAnswerPayload) -> bool:
            """Finish this question with a UI-submitted answer (first-writer-wins).

            Called from the supervisor's submit_answer RPC handler when the
            interviewee picks on screen instead of (or before) answering by
            voice. Returns False if the question was already completed (by voice
            or an earlier click), so the caller can report it was not accepted.
            A clicked answer completes the question directly and does not trigger
            voice probing.
            """
            if self._completed:
                return False
            self._completed = True
            self.complete(
                QuestionTaskResult(
                    questionType=self.question.questionType,
                    questionContent=self.question.questionContent,
                    respondentAnswer=format_ui_answer(answer),
                    probe=None,
                )
            )
            return True

        @function_tool()
        async def record_probe_round(
            self,
            probe_question: str,
            probe_respondent_answer: str,
        ) -> str:
            """Record one probe exchange (a follow-up question and its answer).

            Returns guidance on whether more probing is allowed. The probe-round
            ceiling is enforced here: rounds beyond the maximum are not recorded.
            """
            if self._completed:
                return "This question was already answered on screen. Move on."
            if self._max_rounds <= 0:
                return (
                    "This question is not configured for probing. "
                    "Call complete_question now."
                )

            # Hard upper bound: refuse to record beyond maxRounds.
            if len(self._rounds) >= self._max_rounds:
                return (
                    f"Probe limit of {self._max_rounds} already reached. "
                    "Do not ask another probe — call complete_question now."
                )

            self._rounds.append(
                ProbeRound(
                    probeQuestion=probe_question,
                    respondentAnswer=probe_respondent_answer,
                )
            )
            used = len(self._rounds)

            if used >= self._max_rounds:
                return (
                    f"Recorded probe {used}/{self._max_rounds}. "
                    "Probe limit reached — call complete_question now."
                )
            return (
                f"Recorded probe {used}/{self._max_rounds}. "
                "Ask another probe if useful, or call complete_question to finish."
            )

        @function_tool()
        async def complete_question(self, respondent_answer: str) -> str | None:
            """Finish this question with the consolidated answer to the main question.

            Enforces the lower bound: when probing is configured you must record at
            least one probe round before completing.
            """
            # First-writer-wins: a UI click may have already completed this
            # question. Calling self.complete() again would double-complete.
            if self._completed:
                return None

            probe_config = self.question.probeConfig

            if probe_config is None:
                self._completed = True
                self.complete(
                    QuestionTaskResult(
                        questionType=self.question.questionType,
                        questionContent=self.question.questionContent,
                        respondentAnswer=respondent_answer,
                        probe=None,
                    )
                )
                return None

            # Lower bound: at least one probe is required for the human touch.
            if not self._rounds:
                return (
                    "You must ask at least one probe before finishing. "
                    "Ask a follow-up question and call record_probe_round first."
                )

            self._completed = True
            self.complete(
                QuestionTaskResult(
                    questionType=self.question.questionType,
                    questionContent=self.question.questionContent,
                    respondentAnswer=respondent_answer,
                    probe=ProbeResult(
                        level=probe_config.level,
                        probeInstruction=probe_config.instruction,
                        rounds=list(self._rounds),
                    ),
                )
            )
            return None

    return LiveKitQuestionTask
