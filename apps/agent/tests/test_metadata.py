from agent.metadata import parse_room_metadata


def test_metadata_requires_a_valid_flow_config() -> None:
    empty = parse_room_metadata("{}")
    missing = parse_room_metadata('{"sessionId":"s1","surveyId":"survey-1"}')

    assert empty.reason == "empty"
    assert missing.reason == "missing_flow_config"


def test_metadata_accepts_the_contract_camel_case_shape() -> None:
    parsed = parse_room_metadata(
        '{"sessionId":"s1","surveyId":"survey-1","flowConfig":{'
        '"sessionId":"s1","surveyId":"survey-1","moderatorInstruction":"moderate",'
        '"startStepId":"q1","steps":[{"stepId":"q1","kind":"question",'
        '"questionType":"open_ended","content":"Question","options":[]}],"edges":[]}}'
    )

    assert parsed.ok is True
    assert parsed.metadata is not None
    assert parsed.metadata.flow_config is not None
    assert parsed.metadata.flow_config.start_step_id == "q1"
