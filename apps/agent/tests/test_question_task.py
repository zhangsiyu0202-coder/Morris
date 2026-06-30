"""Unit tests for LiveKitQuestionTask conditional tool registration + confirmation gate.

Covers .kiro/specs/interview-probe-task-hardening/ R1, R2, R4 (TC-1..TC-7).
Mirrors test_livekit_smoke.py shape: a real livekit-agents import is gated by
``pytest.importorskip`` so the file is silently skipped when the realtime
extra is not installed (``uv sync`` without ``--extra realtime``). When the
extra is present, the tests pin two behaviors that the hardening spec exists
to guarantee:

1. ``record_probe_round`` is only registered as a function_tool when the
   question is actually configured for at least one probe round
   (``probeConfig is not None and probeConfig.maxRounds > 0``).
2. ``record_probe_round`` with ``confirmation_heard=False`` is a true no-op:
   no rounds recorded, no completed flag flipped, only a recovery hint
   returned.

The async ``_record_probe_round_impl`` is exercised via ``asyncio.run(...)``
because the agent test suite does not depend on ``pytest-asyncio`` (see
test_workflow.py for the same pattern).
"""
from __future__ import annotations

import asyncio

import pytest

pytest.importorskip("livekit.agents", reason="realtime extra not installed")

from agent.contracts import ProbeConfig, QuestionTaskConfig
from agent.interview.tasks.question import (
    PROBE_GATE_REJECTION,
    create_question_task_class,
)

# Every test in this module instantiates LiveKitQuestionTask (which calls
# asyncio.Future[...] inside AgentTask.__init__) or awaits the async impl,
# so they all need a fresh event loop attached to the main thread. The
# shared fixture lives in tests/conftest.py.
pytestmark = pytest.mark.usefixtures("fresh_event_loop")


# Build once: create_question_task_class() imports livekit.agents lazily; we
# only need a single class object reused across all tests.
TaskCls = create_question_task_class()


def _make_question(probe: ProbeConfig | None) -> QuestionTaskConfig:
    return QuestionTaskConfig(
        questionId="q1",
        questionType="open_ended",
        questionContent="Tell me about your last trip booking.",
        options=[],
        probeConfig=probe,
        stimulus=None,
    )


def _tool_names(task) -> set[str]:
    """Return the set of LLM-visible tool names on a QuestionTask instance.

    LiveKit ``FunctionTool`` instances expose ``.name`` (preferred) or fall
    back to ``.id`` on older 1.x lines. Try both so the test pins behavior
    rather than API surface.
    """
    names: set[str] = set()
    for tool in task.tools:
        name = getattr(tool, "name", None) or getattr(tool, "id", None)
        if name is not None:
            names.add(name)
    return names


# --------------------------------------------------------------------------- #
# R1 / P-FLOW-06: Conditional tool registration
# --------------------------------------------------------------------------- #


def test_no_probe_config_hides_record_probe_round():
    """TC-1: probeConfig=None ⇒ only complete_question is visible."""
    task = TaskCls(question=_make_question(probe=None))
    assert _tool_names(task) == {"complete_question"}


def test_standard_probe_exposes_both_tools():
    """TC-2: probeConfig with maxRounds=3 ⇒ both tools visible."""
    probe = ProbeConfig(level="standard", instruction="probe lightly", maxRounds=3)
    task = TaskCls(question=_make_question(probe=probe))
    assert _tool_names(task) == {"complete_question", "record_probe_round"}


def test_deep_probe_exposes_both_tools():
    """TC-3: probeConfig with maxRounds=5 (deep default) ⇒ both visible."""
    probe = ProbeConfig(level="deep", instruction="probe deeply", maxRounds=5)
    task = TaskCls(question=_make_question(probe=probe))
    assert _tool_names(task) == {"complete_question", "record_probe_round"}


def test_max_rounds_zero_hides_record_probe_round():
    """TC-4: defensive — probeConfig with maxRounds=0 ⇒ tool not registered.

    Production never produces this (zod ``positive()`` + Python default 3),
    but legacy fixtures / direct construction can; the conditional guard
    keeps that path safe.
    """
    probe = ProbeConfig(level="standard", instruction="", maxRounds=0)
    task = TaskCls(question=_make_question(probe=probe))
    assert _tool_names(task) == {"complete_question"}


# --------------------------------------------------------------------------- #
# R2 / P-FLOW-07: confirmation_heard gate
# --------------------------------------------------------------------------- #


def test_confirmation_false_does_not_record():
    """TC-5: confirmation_heard=False is a no-op (no append, no flag change)."""
    probe = ProbeConfig(level="deep", instruction="", maxRounds=3)
    task = TaskCls(question=_make_question(probe=probe))

    result = asyncio.run(
        task._record_probe_round_impl(
            probe_question="Why did you pick Airbnb?",
            probe_respondent_answer="It's habit.",
            confirmation_heard=False,
        )
    )

    assert task._rounds == []
    assert task._completed is False
    # The exact rejection text lives in PROBE_GATE_REJECTION; pin both
    # identity (same constant) and a stable substring so future rewording
    # in the constant module still passes.
    assert result == PROBE_GATE_REJECTION
    assert "confirmation_heard=True" in result


def test_confirmation_true_records_and_counts():
    """TC-6: confirmation_heard=True records the round and returns "Recorded probe 1/N"."""
    probe = ProbeConfig(level="deep", instruction="", maxRounds=3)
    task = TaskCls(question=_make_question(probe=probe))

    result = asyncio.run(
        task._record_probe_round_impl(
            probe_question="Why Airbnb?",
            probe_respondent_answer="Habit.",
            confirmation_heard=True,
        )
    )

    assert len(task._rounds) == 1
    assert task._rounds[0].probeQuestion == "Why Airbnb?"
    assert task._rounds[0].respondentAnswer == "Habit."
    assert result.startswith("Recorded probe 1/3")


def test_confirmation_true_max_rounds_protection():
    """TC-7: confirmation_heard=True still honors the maxRounds upper bound.

    The hardening spec adds the False-path gate without weakening the
    existing upper-bound protection. After ``maxRounds`` rounds, further
    calls are rejected with the "limit reached" message and the ``_rounds``
    list does not grow.
    """
    probe = ProbeConfig(level="standard", instruction="", maxRounds=2)
    task = TaskCls(question=_make_question(probe=probe))

    async def _run_two_then_over() -> str:
        for i in range(2):
            await task._record_probe_round_impl(
                probe_question=f"q{i}",
                probe_respondent_answer=f"a{i}",
                confirmation_heard=True,
            )
        return await task._record_probe_round_impl(
            probe_question="q3",
            probe_respondent_answer="a3",
            confirmation_heard=True,
        )

    over = asyncio.run(_run_two_then_over())

    assert len(task._rounds) == 2
    assert "limit" in over.lower()


# --------------------------------------------------------------------------- #
# Lockstep between conditional registration and complete_question
# --------------------------------------------------------------------------- #
#
# Critical regression guard: if the predicate that decides "register
# record_probe_round?" in __init__ ever diverges from the predicate that
# decides "is this a probing question?" in _complete_question_impl, the LLM
# deadlocks — it is told to "ask a probe first" while the probe tool is not
# even in its tool list. These tests pin both predicates to ``_max_rounds <= 0``
# so the lockstep is verifiable, not merely asserted by spec prose.


def test_no_probe_config_complete_skips_probe_requirement():
    """TC-8: probeConfig=None ⇒ complete_question completes without demanding probe rounds.

    Without this, the LLM would be stuck (record_probe_round is not
    registered, but complete_question would otherwise refuse to finish).
    """
    task = TaskCls(question=_make_question(probe=None))

    result = asyncio.run(task._complete_question_impl(respondent_answer="my answer"))

    assert result is None  # plain path returns None
    assert task._completed is True
    assert task._rounds == []  # no probe rounds were required or recorded


def test_max_rounds_zero_complete_skips_probe_requirement():
    """TC-9: maxRounds=0 (probeConfig set but disabled) ⇒ same as TC-8.

    Catches the Critical regression where _complete_question_impl checks
    ``probeConfig is None`` but registration checks ``maxRounds > 0`` — the
    two predicates must collapse the same set of "no probing" states.
    """
    probe = ProbeConfig(level="standard", instruction="", maxRounds=0)
    task = TaskCls(question=_make_question(probe=probe))

    result = asyncio.run(task._complete_question_impl(respondent_answer="my answer"))

    assert result is None
    assert task._completed is True
    assert task._rounds == []


def test_probing_complete_demands_at_least_one_probe():
    """TC-10: probeConfig with maxRounds>0 + no rounds recorded ⇒ refuse to complete.

    Sanity guard that the lower bound still fires for genuinely-probing
    questions; if we accidentally widened the "skip probe requirement"
    branch, this would catch it.
    """
    probe = ProbeConfig(level="deep", instruction="", maxRounds=3)
    task = TaskCls(question=_make_question(probe=probe))

    result = asyncio.run(task._complete_question_impl(respondent_answer="my answer"))

    assert result is not None  # rejection hint, not None
    assert "probe" in result.lower()
    assert task._completed is False  # MUST NOT have flipped
    assert task._rounds == []
