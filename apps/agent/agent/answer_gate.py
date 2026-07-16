"""First-writer-wins answer gate shared by voice transcripts and UI RPC."""
from __future__ import annotations

from .flow import QuestionResult


class AnswerGate:
    def __init__(self) -> None:
        self.current_question_id: str | None = None
        self.result: QuestionResult | None = None

    @property
    def active(self) -> bool:
        return self.current_question_id is not None and self.result is None

    def begin(self, question_id: str) -> None:
        self.current_question_id = question_id
        self.result = None

    def clear(self) -> None:
        self.current_question_id = None
        self.result = None

    def accept_voice(self, transcript: str) -> bool:
        if not self.active or not transcript.strip():
            return False
        self.result = QuestionResult(transcript.strip())
        return True

    def accept_ui(self, question_id: str, answer: str, selected_option_ids: list[str]) -> bool:
        if not self.active or question_id != self.current_question_id:
            return False
        self.result = QuestionResult(answer.strip(), selected_option_ids)
        return True
