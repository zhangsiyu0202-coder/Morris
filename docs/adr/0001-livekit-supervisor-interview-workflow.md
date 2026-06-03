# ADR 0001: LiveKit Supervisor Workflow for Voice Interviews

## Status

Accepted.

## Context

MerismV2's voice interview module needs to conduct full qualitative interviews over LiveKit. A survey contains multiple sections; each section contains multiple questions. Some questions include probe instructions and probe depth, while questions without probe configuration should be asked without forced probing.

Earlier foundation notes described LangGraph as the realtime interview controller. That approach is no longer the chosen direction. The realtime interview workflow should align with LiveKit Agents' native workflow primitives.

## Decision

Use LiveKit Agents as the primary realtime interview controller:

- `InterviewSupervisorAgent` controls the full interview session.
- Each survey section is represented as one LiveKit `TaskGroup`.
- Each question is represented as one LiveKit `AgentTask`.
- `TaskGroup.add()` receives task factories built dynamically from persisted survey configuration.
- The supervisor owns the global interview instructions and evaluates completed question task results.
- A question task owns only its question content, optional stimulus, optional probe configuration, and local completion behavior.

The data model now includes `SurveySection`, and `QuestionBlock` belongs to a section through `sectionId`.

## Workflow Shape

```text
InterviewSupervisorAgent
  -> Section TaskGroup
       -> QuestionTask
       -> QuestionTask
  -> Section TaskGroup
       -> QuestionTask
       -> QuestionTask
  -> Wrap up
```

The section task group is generated at runtime:

```python
section_group = TaskGroup(
    chat_ctx=self.chat_ctx,
    on_task_completed=self.on_question_completed,
)

for question in section.questions:
    section_group.add(
        lambda q=question: QuestionTask(q),
        id=f"question_{question.id}",
        description=question.content,
    )
```

Use `lambda q=question` so each task factory captures the correct question.

## Question Result Contract

A `QuestionTask` returns a minimal structured result:

```python
QuestionTaskResult:
  questionType
  questionContent
  respondentAnswer
  probe
```

`probe` is `null` when no probing occurred. If probing occurred, it includes:

```python
ProbeResult:
  level
  probeInstruction
  probeQuestion
  respondentAnswer
```

The question id is carried by the task id in the task group results map.

## Consequences

- Do not use LangGraph as the main realtime interview controller.
- Do not create one bespoke Python class per survey or per question.
- Keep a small set of reusable task classes and pass dynamic configuration into them.
- LiveKit `AgentSession` remains responsible for ASR, TTS, interruptions, turn handling, and transcription events.
- Appwrite remains responsible for persisted configuration, transcript segments, task results, recordings, and session state.

## References

- LiveKit Tasks and Task Groups: https://docs.livekit.io/agents/logic/tasks/
- LiveKit Supervisor Pattern: https://docs.livekit.io/agents/logic/supervisor-pattern/
- LiveKit Survey Example: https://github.com/livekit/agents/tree/main/examples/survey
