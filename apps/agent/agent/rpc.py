"""Validation for the wire-level `merism.submit_answer` RPC payload."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .flow import QuestionResult


class UiAnswerPayload(BaseModel):
    question_id: str = Field(alias="questionId", min_length=1)
    section_id: str = Field(alias="sectionId", min_length=1)
    question_type: str = Field(alias="questionType", min_length=1)
    source: Literal["ui", "mixed"]
    text: str = ""
    selected_options: list[str] = Field(default_factory=list, alias="selectedOptions")
    score: float | None = None
    ranking: list[str] = Field(default_factory=list)

    def result(self) -> QuestionResult:
        text = self.text.strip()
        if not text and self.selected_options:
            text = ", ".join(self.selected_options)
        if not text and self.ranking:
            text = " > ".join(self.ranking)
        if not text and self.score is not None:
            text = str(self.score)
        return QuestionResult(text, list(self.selected_options))


class SubmitAnswerRequest(BaseModel):
    answer: UiAnswerPayload


def parse_ui_submission(payload: str) -> tuple[str, QuestionResult] | None:
    try:
        request = SubmitAnswerRequest.model_validate_json(payload)
    except ValidationError:
        return None
    return request.answer.question_id, request.answer.result()
