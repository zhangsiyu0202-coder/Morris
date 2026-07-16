"""Pure interview flow runtime shared by the Gemini Live host and unit tests.

The TypeScript contracts package remains the source of truth.  This deliberately
small Pydantic boundary validates only the JSON passed in LiveKit job metadata;
the execution semantics match the existing declarative graph: code owns step
ordering and Gemini only supplies speech or boolean judgments.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class FlowConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    session_id: str = Field(alias="sessionId", min_length=1)
    survey_id: str = Field(alias="surveyId", min_length=1)
    moderator_instruction: str = Field(alias="moderatorInstruction", min_length=1)
    start_step_id: str = Field(alias="startStepId", min_length=1)
    steps: list[dict[str, Any]]
    edges: list[dict[str, Any]]

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        ids: set[str] = set()
        for step in steps:
            step_id = step.get("stepId")
            kind = step.get("kind")
            if not isinstance(step_id, str) or not step_id:
                raise ValueError("each flow step needs a non-empty stepId")
            if step_id in ids:
                raise ValueError(f"duplicate flow step: {step_id}")
            if kind not in {"question", "probe", "condition"}:
                raise ValueError(f"unsupported flow step kind: {kind!r}")
            ids.add(step_id)
        return steps

    @model_validator(mode="after")
    def validate_graph_references(self) -> "FlowConfig":
        step_ids = {str(step["stepId"]) for step in self.steps}
        if self.start_step_id not in step_ids:
            raise ValueError("startStepId must refer to a flow step")
        edge_ids = {str(edge.get("id", "")) for edge in self.edges}
        for edge in self.edges:
            target = edge.get("to", {}).get("stepId") if isinstance(edge.get("to"), dict) else None
            source = edge.get("from", {}).get("stepId") if isinstance(edge.get("from"), dict) else None
            if source not in step_ids or target not in step_ids:
                raise ValueError("every flow edge endpoint must refer to a flow step")
        for step in self.steps:
            for candidate in [step, *step.get("options", []), *step.get("items", [])]:
                edge_id = candidate.get("outgoingEdgeId") if isinstance(candidate, dict) else None
                if edge_id is not None and edge_id not in edge_ids:
                    raise ValueError("outgoingEdgeId must refer to a flow edge")
        return self


@dataclass(frozen=True)
class QuestionResult:
    respondent_answer: str
    selected_option_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AnswerRecord:
    question_content: str
    respondent_answer: str
    selected_option_ids: list[str]


@dataclass
class FlowState:
    config: FlowConfig
    current_step_id: str | None
    visited_step_ids: list[str] = field(default_factory=list)
    answers: dict[str, AnswerRecord] = field(default_factory=dict)
    probes: dict[str, list[dict[str, str]]] = field(default_factory=dict)


class FlowHost(Protocol):
    async def on_step_enter(self, step_id: str, state: FlowState) -> None: ...
    async def ask_question(self, step: dict[str, Any], state: FlowState) -> QuestionResult: ...
    async def run_probe(self, step: dict[str, Any], state: FlowState) -> list[dict[str, str]]: ...
    async def evaluate_condition(self, condition: str, answer: AnswerRecord, state: FlowState) -> bool: ...
    async def on_flow_completed(self, state: FlowState) -> None: ...


class FlowRunner:
    """Walk the graph with a bounded revisit count so a bad edge cannot loop forever."""

    max_revisits = 3

    def __init__(self, config: FlowConfig, host: FlowHost) -> None:
        self._config = config
        self._host = host
        self._steps = {str(step["stepId"]): step for step in config.steps}
        self._edges = {str(edge["id"]): str(edge["to"]["stepId"]) for edge in config.edges}
        self.state = FlowState(config=config, current_step_id=config.start_step_id)

    async def run(self) -> FlowState:
        state = self.state
        visits: dict[str, int] = {}
        while state.current_step_id is not None:
            step_id = state.current_step_id
            step = self._steps.get(step_id)
            if step is None:
                break
            visits[step_id] = visits.get(step_id, 0) + 1
            if visits[step_id] > self.max_revisits:
                break
            state.visited_step_ids.append(step_id)
            await self._host.on_step_enter(step_id, state)
            next_edge_id = await self._execute(step, state)
            state.current_step_id = self._edges.get(next_edge_id) if next_edge_id else None
        await self._host.on_flow_completed(state)
        return state

    async def _execute(self, step: dict[str, Any], state: FlowState) -> str | None:
        kind = step["kind"]
        if kind == "question":
            result = await self._host.ask_question(step, state)
            state.answers[str(step["stepId"])] = AnswerRecord(
                question_content=str(step.get("content", "")),
                respondent_answer=result.respondent_answer,
                selected_option_ids=list(result.selected_option_ids),
            )
            for option in step.get("options", []):
                if option.get("optionId") in result.selected_option_ids and option.get("outgoingEdgeId"):
                    return str(option["outgoingEdgeId"])
            return _edge_id(step)
        if kind == "probe":
            state.probes[str(step["stepId"])] = await self._host.run_probe(step, state)
            return _edge_id(step)
        if kind == "condition":
            for item in step.get("items", []):
                predicate = item.get("predicate", {})
                answer = state.answers.get(predicate.get("sourceStepId"))
                if answer is not None and await self._host.evaluate_condition(
                    str(predicate.get("condition", "")), answer, state
                ):
                    return _edge_id(item)
            return _edge_id(step)
        return None


def _edge_id(value: dict[str, Any]) -> str | None:
    edge = value.get("outgoingEdgeId")
    return edge if isinstance(edge, str) and edge else None
