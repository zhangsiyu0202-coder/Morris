import asyncio

from agent.flow import FlowConfig, FlowRunner, QuestionResult


class ScriptedHost:
    def __init__(self) -> None:
        self.entered: list[str] = []
        self.completed = False

    async def on_step_enter(self, step_id: str, _state: object) -> None:
        self.entered.append(step_id)

    async def ask_question(self, step: dict[str, object], _state: object) -> QuestionResult:
        if step["stepId"] == "q1":
            return QuestionResult("yes", ["yes"])
        return QuestionResult("done")

    async def run_probe(self, _step: dict[str, object], _state: object) -> list[dict[str, str]]:
        return []

    async def evaluate_condition(self, _condition: str, _answer: object, _state: object) -> bool:
        return False

    async def on_flow_completed(self, _state: object) -> None:
        self.completed = True


def test_question_option_edge_wins_over_default_and_records_answer() -> None:
    config = FlowConfig.model_validate(
        {
            "sessionId": "s1",
            "surveyId": "survey-1",
            "moderatorInstruction": "Be concise.",
            "startStepId": "q1",
            "steps": [
                {
                    "stepId": "q1",
                    "kind": "question",
                    "questionType": "single_choice",
                    "content": "Continue?",
                    "options": [{"optionId": "yes", "content": "Yes", "outgoingEdgeId": "to-q2"}],
                    "outgoingEdgeId": "to-end",
                },
                {
                    "stepId": "q2",
                    "kind": "question",
                    "questionType": "open_ended",
                    "content": "Why?",
                    "options": [],
                    "outgoingEdgeId": None,
                },
            ],
            "edges": [
                {"id": "to-q2", "from": {"stepId": "q1"}, "to": {"stepId": "q2"}},
                {"id": "to-end", "from": {"stepId": "q1"}, "to": {"stepId": "q2"}},
            ],
        }
    )
    host = ScriptedHost()

    state = asyncio.run(FlowRunner(config, host).run())

    assert host.entered == ["q1", "q2"]
    assert host.completed is True
    assert state.answers["q1"].respondent_answer == "yes"
    assert state.visited_step_ids == ["q1", "q2"]


def test_condition_falls_back_when_source_answer_is_missing() -> None:
    config = FlowConfig.model_validate(
        {
            "sessionId": "s1",
            "surveyId": "survey-1",
            "moderatorInstruction": "Be concise.",
            "startStepId": "c1",
            "steps": [
                {
                    "stepId": "c1",
                    "kind": "condition",
                    "items": [
                        {
                            "itemId": "only",
                            "predicate": {"sourceStepId": "missing", "condition": "is eligible"},
                            "outgoingEdgeId": None,
                        }
                    ],
                    "outgoingEdgeId": None,
                }
            ],
            "edges": [],
        }
    )
    host = ScriptedHost()

    state = asyncio.run(FlowRunner(config, host).run())

    assert host.entered == ["c1"]
    assert state.visited_step_ids == ["c1"]


def test_cyclic_flow_stops_at_the_revisit_limit_and_completes_once() -> None:
    config = FlowConfig.model_validate(
        {
            "sessionId": "s1",
            "surveyId": "survey-1",
            "moderatorInstruction": "Be concise.",
            "startStepId": "q1",
            "steps": [
                {
                    "stepId": "q1",
                    "kind": "question",
                    "questionType": "open_ended",
                    "content": "Loop?",
                    "options": [],
                    "outgoingEdgeId": "loop",
                }
            ],
            "edges": [{"id": "loop", "from": {"stepId": "q1"}, "to": {"stepId": "q1"}}],
        }
    )
    host = ScriptedHost()

    state = asyncio.run(FlowRunner(config, host).run())

    assert state.visited_step_ids == ["q1", "q1", "q1"]
    assert host.completed is True


def test_flow_config_rejects_an_edge_to_a_missing_step() -> None:
    invalid = {
        "sessionId": "s1",
        "surveyId": "survey-1",
        "moderatorInstruction": "Be concise.",
        "startStepId": "q1",
        "steps": [
            {
                "stepId": "q1",
                "kind": "question",
                "questionType": "open_ended",
                "content": "Question",
                "options": [],
                "outgoingEdgeId": "missing-target",
            }
        ],
        "edges": [
            {"id": "missing-target", "from": {"stepId": "q1"}, "to": {"stepId": "missing"}}
        ],
    }

    try:
        FlowConfig.model_validate(invalid)
    except ValueError as error:
        assert "flow edge endpoint" in str(error)
    else:
        raise AssertionError("dangling edges must fail closed")
