"""Generic question task for a configured interview question."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any, Final

from agent.contracts import (
    InterviewAnswerPayload,
    ProbeResult,
    ProbeRound,
    QuestionTaskConfig,
    QuestionTaskResult,
)
from agent.interview.workflow import format_ui_answer


# --------------------------------------------------------------------------- #
# Tool descriptions — exposed as module-level constants / factories so that:
#   (1) build_question_instructions and the description payloads stay in sync
#       (changing one breaks the property test that pins the wording),
#   (2) tests can grep for the exact rejection text without reaching into the
#       LiveKitQuestionTask closure,
#   (3) the conditional-registration code path in __init__ stays compact.
#
# Borrowed shape from LiveKit "Tool loop design" § Write descriptions the model
# can act on (https://docs.livekit.io/agents/logic/tools/design/#write-descriptions-the-model-can-act-on):
# describe what the tool does, when to call it, when not to, and parameter
# semantics (especially for the self-reporting `confirmation_heard`).
# --------------------------------------------------------------------------- #

COMPLETE_QUESTION_DESCRIPTION: Final[str] = """\
Finish the current interview question and submit the respondent's consolidated answer.

Call this when:
- For a non-probing question: as soon as the respondent has given their answer.
- For a probing question: after you have completed at least one probe round
  (recorded via record_probe_round) and you judge the answer is fully explored.

Do not call this:
- Before the respondent has answered the main question.
- For a probing question, before any record_probe_round has been recorded.

Args:
    respondent_answer: The consolidated answer to the main question, as a
        single string. For multi-turn answers, summarize what the respondent
        actually said in their own voice — do not paraphrase or interpret.
"""


PROBE_GATE_REJECTION: Final[str] = (
    "You must actually voice the probe out loud and wait for the respondent's "
    "answer before recording. Ask the probe now; after you hear the response, "
    "call this tool again with confirmation_heard=True. If the respondent is "
    "refusing or has gone silent, you may still record with the verbatim "
    "refusal or 'no answer' as probe_respondent_answer — but only after you "
    "actually heard them say so."
)


def _record_probe_round_description(max_rounds: int) -> str:
    """Build the record_probe_round tool description for a specific max_rounds.

    Injecting the numeric ceiling into the description (rather than relying on
    instructions alone) makes the limit visible at tool-selection time, which
    LiveKit Tool loop design recommends:
    https://docs.livekit.io/agents/logic/tools/design/#pin-down-parameter-values
    """
    return f"""\
Record one probe exchange (a follow-up question and the respondent's answer to it).

This question allows up to {max_rounds} probe rounds. The tool will reject
recording beyond {max_rounds} rounds and tell you to call complete_question.

Call this:
- AFTER you have voiced a probing follow-up out loud AND heard the respondent answer.
- Once per probe round; do not batch multiple probes into one call.

Do not call this:
- For a probe you only thought about asking but did not voice.
- Before the respondent has answered the probe.
- When this question is not configured for probing (you will not see this tool
  in that case; if you somehow see it without configuration, do not call it).

Args:
    probe_question: The probe follow-up you actually voiced — the literal
        sentence you asked the respondent, not a paraphrase or a probe you
        only considered.
    probe_respondent_answer: The respondent's actual spoken answer to the
        probe. Include refusals or "I don't know" verbatim; do not substitute
        a placeholder.
    confirmation_heard: Self-reporting gate. Set True ONLY after BOTH:
        (1) you have actually voiced the probe question, AND
        (2) the respondent has actually answered (any answer, including
            refusal or "I don't know").
        Set False if you have not yet asked OR if the respondent has not yet
        answered. NEVER set True for a probe you only thought about asking
        but did not voice.
"""


def build_question_instructions(question: QuestionTaskConfig) -> str:
    probe = question.probeConfig
    probe_text = ""
    # Sync with conditional tool registration in LiveKitQuestionTask.__init__:
    # only inject the probe section when the question actually permits at
    # least one probe round. probeConfig=None or maxRounds==0 ⇒ no probe.
    if probe is not None and probe.maxRounds > 0:
        guidance = probe.instruction.strip() or "(no specific guidance — probe at your discretion)"
        probe_text = f"""

Probing (this question is always probed):
- Probe level: {probe.level}
- Probe guidance: {guidance}
- Maximum probe rounds: {probe.maxRounds}
- You MUST ask at least one probe before finishing this question — never jump
  straight to the next question. That feels robotic and loses the human touch.
- After each probe exchange, call record_probe_round with the probe question,
  the respondent's answer, AND confirmation_heard=True.
- Set confirmation_heard=True ONLY after you have ACTUALLY voiced the probe and
  ACTUALLY heard the respondent answer it. Never set True for a probe you only
  thought about asking but did not voice.
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

    chat_ctx = chat_ctx.copy()
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

            # Conditional tool registration (interview-probe-task-hardening spec):
            # complete_question is always available — any question must be able
            # to finish. record_probe_round is only registered when this question
            # is configured for at least one probe round, so the LLM does not
            # even see the tool for non-probing questions (per LiveKit Tool loop
            # design § Focus the toolset).
            tools: list[Any] = [
                function_tool(
                    self._complete_question_impl,
                    name="complete_question",
                    description=COMPLETE_QUESTION_DESCRIPTION,
                ),
            ]
            probe = question.probeConfig
            if probe is not None and probe.maxRounds > 0:
                tools.append(
                    function_tool(
                        self._record_probe_round_impl,
                        name="record_probe_round",
                        description=_record_probe_round_description(probe.maxRounds),
                    )
                )

            super().__init__(
                instructions=build_question_instructions(question),
                chat_ctx=chat_ctx,
                tools=tools,
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

        async def _record_probe_round_impl(
            self,
            probe_question: str,
            probe_respondent_answer: str,
            confirmation_heard: bool,
        ) -> str:
            """Plain async impl. Registered as a function_tool conditionally in
            __init__ (only when probeConfig.maxRounds > 0). The LLM-facing
            description lives in _record_probe_round_description() at module
            scope so tests can pin the wording independently of the closure.
            """
            # SelfReportingConfirmation gate — must run BEFORE any state branch
            # so that confirmation_heard=False is a true no-op (it must not
            # bump rounds, must not flip completed, and must not emit a
            # "limit reached" / "already done" message that would mislead the
            # LLM about system state).
            if not confirmation_heard:
                return PROBE_GATE_REJECTION

            if self._completed:
                return "This question was already answered on screen. Move on."

            # Note: an explicit `_max_rounds <= 0` check here would be dead
            # code — conditional registration in __init__ guarantees this
            # method is only reachable when maxRounds > 0. If you ever need
            # to call this impl directly from a unit test under a degenerate
            # config, fix the test (set maxRounds > 0) rather than re-adding
            # the defensive branch.

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

        async def _complete_question_impl(self, respondent_answer: str) -> str | None:
            """Plain async impl. Registered as a function_tool in __init__.
            The LLM-facing description lives in COMPLETE_QUESTION_DESCRIPTION
            at module scope so tests can pin the wording independently of the
            closure.

            Enforces the lower bound: when probing is configured you must
            record at least one probe round before completing.
            """
            # First-writer-wins: a UI click may have already completed this
            # question. Calling self.complete() again would double-complete.
            if self._completed:
                return None

            # "No probing" path. Use _max_rounds (which collapses both
            # probeConfig=None and probeConfig.maxRounds==0 into 0) so this
            # branch stays in lockstep with the conditional registration
            # decision in __init__. Diverging the two predicates here is what
            # would otherwise cause a deadlock: registration hiding
            # record_probe_round from the LLM while this method still
            # demands "ask a probe first".
            if self._max_rounds <= 0:
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

            # probeConfig is guaranteed non-None here because _max_rounds > 0.
            # mypy-pleasing local pin so we can read .level / .instruction
            # without a separate None-check.
            probe_config = self.question.probeConfig
            assert probe_config is not None  # invariant: _max_rounds > 0 ⇒ probeConfig set

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
