"""The sole worker-to-Appwrite persistence exit: finalizeInterviewSession."""
from __future__ import annotations

import os
from typing import Any

import httpx


async def finalize_interview_session(
    *,
    session_id: str,
    survey_id: str,
    terminal_status: str,
    collected_answers: dict[str, dict[str, Any]],
    transcript: dict[str, Any] | None,
    env: dict[str, str] | None = None,
) -> None:
    source = os.environ if env is None else env
    required = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"]
    missing = [name for name in required if not source.get(name)]
    if missing:
        raise RuntimeError(f"finalize_not_configured:{','.join(missing)}")
    body = {
        "sessionId": session_id,
        "surveyId": survey_id,
        "terminalStatus": terminal_status,
        "collectedAnswers": collected_answers,
    }
    if transcript is not None:
        body["transcript"] = transcript
    endpoint = source["APPWRITE_ENDPOINT"].rstrip("/")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{endpoint}/functions/finalizeInterviewSession/executions",
            headers={
                "content-type": "application/json",
                "X-Appwrite-Project": source["APPWRITE_PROJECT_ID"],
                "X-Appwrite-Key": source["APPWRITE_API_KEY"],
            },
            json={"body": __import__("json").dumps(body), "async": False, "path": "/", "method": "POST"},
        )
    if response.status_code >= 400:
        raise RuntimeError(f"finalizeInterviewSession execution API returned {response.status_code}")
    execution = response.json()
    status = execution.get("responseStatusCode")
    if execution.get("status") != "completed" or not isinstance(status, int) or status >= 400:
        raise RuntimeError("finalizeInterviewSession returned an unsuccessful execution")
    try:
        result = __import__("json").loads(execution["responseBody"])
    except (KeyError, TypeError, ValueError):
        raise RuntimeError("finalizeInterviewSession returned an invalid response body") from None
    if result.get("ok") is not True or result.get("sessionId") != session_id:
        raise RuntimeError("finalizeInterviewSession returned an invalid response body")
