import asyncio

from agent.finalize import finalize_interview_session


def test_finalizer_fails_closed_when_appwrite_configuration_is_missing() -> None:
    async def call() -> None:
        await finalize_interview_session(
            session_id="session-1",
            survey_id="survey-1",
            terminal_status="completed",
            collected_answers={},
            transcript=None,
            env={},
        )

    try:
        asyncio.run(call())
    except RuntimeError as error:
        assert str(error) == "finalize_not_configured:APPWRITE_ENDPOINT,APPWRITE_PROJECT_ID,APPWRITE_API_KEY"
    else:
        raise AssertionError("finalization must not silently skip persistence")
