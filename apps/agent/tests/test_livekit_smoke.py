"""LiveKit API-surface smoke (gated on the realtime extra).

Skipped when livekit-agents is not installed (default `uv sync` without
`--extra realtime`, per testing.md). When present, it pins the parts of the
livekit-agents API our interview engine depends on, so a version bump that
changes them (e.g. 1.6 removed ``TaskGroup.run()`` in favor of awaiting the
task) fails here instead of only at runtime in a live voice session.
"""
from __future__ import annotations

import inspect

import pytest

pytest.importorskip("livekit.agents", reason="realtime extra not installed")


def test_core_symbols_import():
    from livekit.agents import (  # noqa: F401
        Agent,
        AgentSession,
        AgentTask,
        WorkerOptions,
        cli,
        function_tool,
    )
    from livekit.agents.beta.workflows import TaskGroup, TaskGroupResult  # noqa: F401
    from livekit.agents.voice.room_io import RoomOptions, TextOutputOptions  # noqa: F401

    assert callable(function_tool)


def test_taskgroup_is_awaited_not_run():
    """TaskGroup is an awaitable AgentTask; 1.6 dropped ``.run()``.

    The supervisor awaits the TaskGroup and reads ``TaskGroupResult.task_results``.
    """
    import dataclasses

    from livekit.agents import AgentTask
    from livekit.agents.beta.workflows import TaskGroup, TaskGroupResult

    assert issubclass(TaskGroup, AgentTask)
    assert hasattr(AgentTask, "__await__")
    assert not hasattr(TaskGroup, "run")
    assert hasattr(TaskGroup, "add")
    assert {f.name for f in dataclasses.fields(TaskGroupResult)} == {"task_results"}


def test_agent_session_and_room_options_params():
    from livekit.agents import AgentSession
    from livekit.agents.voice.room_io import RoomOptions, TextOutputOptions

    session_params = set(inspect.signature(AgentSession.__init__).parameters)
    assert {"stt", "vad", "llm", "tts"} <= session_params
    assert "room_options" in inspect.signature(AgentSession.start).parameters

    assert "text_output" in inspect.signature(RoomOptions.__init__).parameters
    assert "sync_transcription" in inspect.signature(TextOutputOptions.__init__).parameters


def test_agent_task_external_completion_surface():
    """The UI-click answer path calls self.complete() / checks done() on the task."""
    from livekit.agents import AgentTask

    assert hasattr(AgentTask, "complete")
    assert hasattr(AgentTask, "done")


def test_interview_factories_build_under_installed_livekit():
    from agent.contracts import QuestionTaskConfig, SectionTaskGroupConfig
    from agent.interview.supervisor import create_supervisor_agent_class
    from agent.interview.task_group_builder import build_section_task_group
    from agent.interview.tasks.question import create_question_task_class

    supervisor_cls = create_supervisor_agent_class()
    question_cls = create_question_task_class()
    assert supervisor_cls.__name__ == "InterviewSupervisorAgent"
    assert hasattr(question_cls, "complete_with_ui_answer")

    section = SectionTaskGroupConfig(
        sectionId="s1",
        title="T",
        description="",
        sectionInstruction=None,
        questions=[
            QuestionTaskConfig(
                questionId="q1",
                questionType="single_choice",
                questionContent="pick",
                options=["A", "B"],
            )
        ],
    )
    task_group = build_section_task_group(
        section, chat_ctx=None, on_question_enter=lambda qid, task: None
    )
    assert type(task_group).__name__ == "TaskGroup"


def test_gemini_realtime_enables_context_window_compression():
    """Gemini Live caps audio sessions at ~15 min without context compression.

    Our build must enable sliding-window compression so long interviews are not
    cut off. Session resumption is left to the livekit plugin (auto-managed).
    """
    pytest.importorskip("google.genai", reason="realtime extra not installed")
    from google.genai import types

    from agent.providers.gemini import _realtime_kwargs
    from agent.providers.settings import GeminiSettings

    kwargs = _realtime_kwargs(
        GeminiSettings(api_key="test-key", model="gemini-live", language="en-US")
    )

    assert kwargs["modalities"] == ["TEXT"]
    cwc = kwargs["context_window_compression"]
    assert isinstance(cwc, types.ContextWindowCompressionConfig)
    assert cwc.sliding_window is not None
    # Resumption is the plugin's job — we must not be passing our own config.
    assert "session_resumption" not in kwargs
