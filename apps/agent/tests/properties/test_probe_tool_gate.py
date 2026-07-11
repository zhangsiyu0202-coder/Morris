"""Property tests for P-FLOW-06 + P-FLOW-07.

Covers .kiro/specs/interview-probe-task-hardening/ §5 Correctness Properties:

P-FLOW-06: For any legal QuestionTaskConfig, ``LiveKitQuestionTask(question).tools``
           exposes ``record_probe_round`` if and only if
           ``question.probeConfig is not None and question.probeConfig.maxRounds > 0``.
           ``complete_question`` is always exposed.

P-FLOW-07: For any question whose ``probeConfig.maxRounds > 0`` and any number
           of ``record_probe_round`` calls with ``confirmation_heard=False``,
           ``task._rounds`` remains empty.

Guards against silent regression to "static decorator + no confirmation" shape
that this sub-spec exists to prevent. Skipped when ``livekit-agents`` is not
installed (default ``uv sync`` without ``--extra realtime``).
"""
from __future__ import annotations

import asyncio

import pytest

pytest.importorskip("livekit.agents", reason="realtime extra not installed")

from hypothesis import given, settings
from hypothesis import strategies as st

from agent.contracts import ProbeConfig, QuestionTaskConfig
from agent.interview.tasks.question import create_question_task_class

# Same rationale as tests/test_question_task.py: every property body
# instantiates LiveKitQuestionTask. Fixture lives in tests/conftest.py.
pytestmark = pytest.mark.usefixtures("fresh_event_loop")


# Build once at module scope; cheap (lazy livekit-agents import already done
# at module top via the importorskip above + the factory's own internal import).
TaskCls = create_question_task_class()


def _make_question(probe: ProbeConfig | None) -> QuestionTaskConfig:
    return QuestionTaskConfig(
        questionId="q1",
        questionType="open_ended",
        questionContent="x",
        options=[],
        probeConfig=probe,
        stimulus=None,
    )


def _tool_names(task) -> set[str]:
    names: set[str] = set()
    for tool in task.tools:
        name = getattr(tool, "name", None) or getattr(tool, "id", None)
        if name is not None:
            names.add(name)
    return names


# `probeConfig` can legally be either None or a real ProbeConfig. maxRounds
# range covers 0 (defensive) and the standard/deep production values plus a
# wider band so the property hits boundary cases.
probe_config_strategy = st.one_of(
    st.none(),
    st.builds(
        ProbeConfig,
        level=st.sampled_from(["standard", "deep"]),
        instruction=st.text(min_size=0, max_size=200),
        maxRounds=st.integers(min_value=0, max_value=10),
    ),
)


@given(probe=probe_config_strategy)
@settings(max_examples=50, deadline=None)
def test_p_flow_06_tool_visibility_matches_probe_config(probe):
    """P-FLOW-06: record_probe_round visible iff probe is not None and maxRounds > 0.

    complete_question is always visible.
    """
    task = TaskCls(question=_make_question(probe=probe))
    tool_names = _tool_names(task)
    assert "complete_question" in tool_names

    should_have_record = probe is not None and probe.maxRounds > 0
    assert ("record_probe_round" in tool_names) == should_have_record


# Generator over probe configs that always permit at least one round, since
# P-FLOW-07 is only meaningful when record_probe_round is registered.
positive_probe_strategy = st.builds(
    ProbeConfig,
    level=st.sampled_from(["standard", "deep"]),
    instruction=st.text(min_size=0, max_size=100),
    maxRounds=st.integers(min_value=1, max_value=10),
)


@given(
    probe=positive_probe_strategy,
    probe_q=st.text(min_size=1, max_size=50),
    probe_a=st.text(min_size=1, max_size=50),
    n_calls=st.integers(min_value=1, max_value=5),
)
@settings(max_examples=30, deadline=None)
def test_p_flow_07_confirmation_false_never_records(probe, probe_q, probe_a, n_calls):
    """P-FLOW-07: confirmation_heard=False called N times leaves _rounds empty."""
    task = TaskCls(question=_make_question(probe=probe))

    async def _run() -> None:
        for _ in range(n_calls):
            await task._record_probe_round_impl(
                probe_question=probe_q,
                probe_respondent_answer=probe_a,
                confirmation_heard=False,
            )

    asyncio.get_event_loop().run_until_complete(_run())

    assert task._rounds == []
    assert task._completed is False
