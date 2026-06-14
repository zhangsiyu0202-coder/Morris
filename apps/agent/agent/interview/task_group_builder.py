"""Build LiveKit TaskGroups from Merism interview configuration."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from agent.contracts import SectionTaskGroupConfig
from agent.interview.tasks.question import create_question_task_class

TaskCompletedCallback = Callable[[Any], Awaitable[None]]


def build_section_task_group(
    section: SectionTaskGroupConfig,
    *,
    chat_ctx: Any,
    on_task_completed: TaskCompletedCallback | None = None,
    on_question_enter: Callable[[str, Any], None] | None = None,
):
    """Create one LiveKit TaskGroup for one survey section.

    LiveKit expects task factories, so each question is captured with
    `lambda q=question` to avoid Python late-binding all factories to the
    final loop value. ``on_question_enter`` is invoked with (questionId, task)
    when each question task starts, so the Supervisor can publish the current
    question to the room for structured rendering and hold a handle to complete
    the task from a UI click.
    """
    from livekit.agents.beta.workflows import TaskGroup

    question_task_class = create_question_task_class()
    task_group = TaskGroup(
        chat_ctx=chat_ctx,
        on_task_completed=on_task_completed,
    )

    for question in section.questions:
        on_enter_publish = (
            (lambda task, qid=question.questionId: on_question_enter(qid, task))
            if on_question_enter is not None
            else None
        )
        task_group.add(
            lambda q=question, cb=on_enter_publish: question_task_class(q, on_enter_publish=cb),
            id=f"question_{question.questionId}",
            description=question.questionContent,
        )

    return task_group
