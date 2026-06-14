"""Generic question task for a configured interview question."""
from __future__ import annotations

from collections.abc import Callable

from agent.contracts import (
    ProbeResult,
    ProbeRound,
    QuestionTaskConfig,
    QuestionTaskResult,
)


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
        stimulus_text = """

This question has a stimulus. Wait for the supervisor/frontend to show it before asking.
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


def create_question_task_class():
    from livekit.agents import AgentTask, function_tool

    class LiveKitQuestionTask(AgentTask[QuestionTaskResult]):
        def __init__(
            self,
            question: QuestionTaskConfig,
            chat_ctx=None,
            on_enter_publish: Callable[[], None] | None = None,
        ) -> None:
            self.question = question
            self._on_enter_publish = on_enter_publish
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
            # Publish the current question to the room first, so the interviewee
            # portal can render its structured control before the AI speaks.
            if self._on_enter_publish is not None:
                self._on_enter_publish()
            await self.session.generate_reply(
                instructions=f"Ask this interview question naturally: {self.question.questionContent}"
            )

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
            probe_config = self.question.probeConfig

            if probe_config is None:
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
