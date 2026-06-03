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
):
    """Create one LiveKit TaskGroup for one survey section.

    LiveKit expects task factories, so each question is captured with
    `lambda q=question` to avoid Python late-binding all factories to the
    final loop value.
    """
    from livekit.agents.beta.workflows import TaskGroup

    question_task_class = create_question_task_class()
    task_group = TaskGroup(
        chat_ctx=chat_ctx,
        on_task_completed=on_task_completed,
    )

    for question in section.questions:
        task_group.add(
            lambda q=question: question_task_class(q),
            id=f"question_{question.questionId}",
            description=question.questionContent,
        )

    return task_group
