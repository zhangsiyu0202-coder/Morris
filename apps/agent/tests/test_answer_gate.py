from agent.answer_gate import AnswerGate


def test_final_voice_transcript_wins_over_later_ui_submission() -> None:
    gate = AnswerGate()
    gate.begin("q1")

    assert gate.accept_voice("voice answer") is True
    assert gate.accept_ui("q1", "ui answer", ["option-1"]) is False
    assert gate.result is not None
    assert gate.result.respondent_answer == "voice answer"


def test_ui_submission_requires_the_current_question() -> None:
    gate = AnswerGate()
    gate.begin("q1")

    assert gate.accept_ui("stale", "answer", []) is False
    assert gate.accept_ui("q1", "answer", ["option-1"]) is True
    assert gate.result is not None
    assert gate.result.selected_option_ids == ["option-1"]
