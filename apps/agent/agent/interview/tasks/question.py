"""Generic question task for a configured interview question."""
from __future__ import annotations

from agent.contracts import ProbeResult, QuestionTaskConfig, QuestionTaskResult


def build_question_instructions(question: QuestionTaskConfig) -> str:
    probe = question.probeConfig
    probe_text = ""
    if probe is not None:
        probe_text = f"""

Probe instructions:
- Probe level: {probe.level}
- Probe guidance: {probe.instruction}
- Maximum probe rounds: {probe.maxRounds}
- If you ask a probe, record the original answer and the probe exchange with record_answer_with_probe.
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
{stimulus_text}
Ask the question naturally and keep the interview conversational.
When the respondent has answered, call exactly one result tool:
- record_answer if there was no probe.
- record_answer_with_probe if you asked a probe.

Do not invent fields outside the tool arguments. Do not expose internal task names.
{probe_text}
"""


def create_question_task_class():
    from livekit.agents import AgentTask, function_tool

    class LiveKitQuestionTask(AgentTask[QuestionTaskResult]):
        def __init__(self, question: QuestionTaskConfig, chat_ctx=None) -> None:
            self.question = question
            super().__init__(
                instructions=build_question_instructions(question),
                chat_ctx=chat_ctx,
            )

        async def on_enter(self) -> None:
            await self.session.generate_reply(
                instructions=f"Ask this interview question naturally: {self.question.questionContent}"
            )

        @function_tool()
        async def record_answer(self, respondent_answer: str) -> None:
            """Record the respondent's answer when no probe was asked."""
            self.complete(
                QuestionTaskResult(
                    questionType=self.question.questionType,
                    questionContent=self.question.questionContent,
                    respondentAnswer=respondent_answer,
                    probe=None,
                )
            )

        @function_tool()
        async def record_answer_with_probe(
            self,
            respondent_answer: str,
            probe_question: str,
            probe_respondent_answer: str,
        ) -> None:
            """Record the respondent's answer plus the probe exchange."""
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
                return

            self.complete(
                QuestionTaskResult(
                    questionType=self.question.questionType,
                    questionContent=self.question.questionContent,
                    respondentAnswer=respondent_answer,
                    probe=ProbeResult(
                        level=probe_config.level,
                        probeInstruction=probe_config.instruction,
                        probeQuestion=probe_question,
                        respondentAnswer=probe_respondent_answer,
                    ),
                )
            )

    return LiveKitQuestionTask
