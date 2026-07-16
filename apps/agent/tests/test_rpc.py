from agent.rpc import parse_ui_submission


def test_ui_rpc_requires_the_contract_shape_and_rejects_voice_spoofing() -> None:
    assert parse_ui_submission('{"answer":{"questionId":"q1"}}') is None
    assert parse_ui_submission(
        '{"answer":{"questionId":"q1","sectionId":"s1","questionType":"open_ended","source":"voice"}}'
    ) is None

    parsed = parse_ui_submission(
        '{"answer":{"questionId":"q1","sectionId":"s1","questionType":"single_choice",'
        '"source":"ui","selectedOptions":["opt-1"]}}'
    )

    assert parsed is not None
    assert parsed[0] == "q1"
    assert parsed[1].respondent_answer == "opt-1"
    assert parsed[1].selected_option_ids == ["opt-1"]
