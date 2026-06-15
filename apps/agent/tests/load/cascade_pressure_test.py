"""Cascade pressure test — drives DeepSeek through the 20-question long survey
with a scripted fake interviewee, end-to-end without LiveKit.

Why bypass LiveKit: the actual question task's behaviour we want to stress-test
is pure-LLM tool-calling discipline (record_probe_round / complete_question) +
adherence to the per-question instructions. Wiring LiveKit + Qwen STT/TTS is
overhead that doesn't change the model's pass/fail. Audio costs ¥0; this
exercises everything the model has to get right.

Run:
    cd apps/agent
    uv run python -m tests.load.cascade_pressure_test [--quick]

`--quick` runs the first 5 questions only (~2-3 min) for smoke-checking the
harness itself before kicking off the full 15+ min run.

Output: a JSON report at /tmp/merism/cascade_pressure_<timestamp>.json plus
human-readable progress to stdout.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx

from agent.contracts import (
    ProbeConfig,
    QuestionTaskConfig,
    QuestionType,
)
from agent.interview.tasks.question import build_question_instructions

from tests.load.long_survey_fixture import (
    LONG_RUNTIME_STUDY,
    SCRIPTED_ANSWERS,
    total_questions,
)


# ---------------------------------------------------------------------------
# DeepSeek configuration
# ---------------------------------------------------------------------------

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
PROBE_DEFAULT_MAX_ROUNDS = {"standard": 3, "deep": 5}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "record_probe_round",
            "description": (
                "Record one probe exchange (a follow-up question you asked and "
                "the respondent's answer to it)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "probe_question": {
                        "type": "string",
                        "description": "The follow-up question you just asked.",
                    },
                    "probe_respondent_answer": {
                        "type": "string",
                        "description": "What the respondent answered to that follow-up.",
                    },
                },
                "required": ["probe_question", "probe_respondent_answer"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_question",
            "description": (
                "Finish this question with the consolidated answer to the main "
                "question. Call this only after at least one probe round."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "respondent_answer": {
                        "type": "string",
                        "description": "Consolidated answer to the main question.",
                    },
                },
                "required": ["respondent_answer"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Per-run stats
# ---------------------------------------------------------------------------

@dataclass
class QuestionRunStats:
    questionId: str
    questionType: str
    probeLevel: str
    maxRounds: int
    actualRounds: int = 0
    completed: bool = False
    elapsedSec: float = 0.0
    inputTokens: int = 0
    outputTokens: int = 0
    completedAnswer: str = ""
    askedQuestion: str = ""
    probeQuestions: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass
class SurveyRunStats:
    runId: str
    model: str
    startedAt: float
    elapsedSec: float = 0.0
    totalInputTokens: int = 0
    totalOutputTokens: int = 0
    questions: list[QuestionRunStats] = field(default_factory=list)

    @property
    def completedQuestions(self) -> int:
        return sum(1 for q in self.questions if q.completed)

    @property
    def completionRate(self) -> float:
        return self.completedQuestions / max(1, len(self.questions))

    @property
    def estimatedCostUsd(self) -> float:
        """DeepSeek-chat pricing (2026-06): $0.14/M input, $0.28/M output."""
        return self.totalInputTokens * 0.14e-6 + self.totalOutputTokens * 0.28e-6

    def to_dict(self) -> dict:
        d = asdict(self)
        d["completedQuestions"] = self.completedQuestions
        d["completionRate"] = self.completionRate
        d["estimatedCostUsd"] = self.estimatedCostUsd
        d["totalQuestions"] = len(self.questions)
        return d


# ---------------------------------------------------------------------------
# DeepSeek HTTP call (one chat-completions round)
# ---------------------------------------------------------------------------

class DeepSeekClient:
    def __init__(self, api_key: str) -> None:
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    async def chat(self, messages: list[dict], tools: list[dict]) -> dict:
        body = {
            "model": DEEPSEEK_MODEL,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "temperature": 0.7,
            "max_tokens": 1024,
        }
        resp = await self._client.post(DEEPSEEK_URL, json=body)
        resp.raise_for_status()
        return resp.json()

    async def aclose(self) -> None:
        await self._client.aclose()


def supervisor_system_prompt() -> str:
    """Build the survey-wide system prompt the supervisor would set."""
    s = LONG_RUNTIME_STUDY
    return (
        f"You are an AI qualitative interviewer for the study \"{s.studyTitle}\".\n"
        f"Research goal: {s.researchGoal}\n"
        f"Target audience: {s.targetAudience}\n"
        f"Opening script: {s.introScript}\n"
        "Conduct the interview section by section, keep it conversational, ask the "
        "configured probes only when a question has probe guidance, and never reveal "
        "internal task or section identifiers."
    )


def build_question_task_config(question, section) -> QuestionTaskConfig:
    """Mirror what task_group_builder builds at runtime."""
    qtype: QuestionType = question.questionType  # type: ignore[assignment]
    return QuestionTaskConfig(
        questionId=question.questionId,
        questionType=qtype,
        questionContent=question.questionText,
        options=list(question.options),
        probeConfig=ProbeConfig(
            level=question.probeLevel,
            instruction=question.probeInstruction,
            maxRounds=PROBE_DEFAULT_MAX_ROUNDS[question.probeLevel],
        ),
    )


def fake_interviewee_answer(question_id: str, kind: str, round_idx: int) -> str:
    """Return a scripted fake-interviewee reply.

    `kind`:
      'main'  -> first answer to the main question
      'probe' -> follow-up answer; round_idx picks which scripted probe to use
                 (mod 5 so we never overflow even if the model probes >5 times).
    """
    entry = SCRIPTED_ANSWERS[question_id]
    if kind == "main":
        return entry["main"]  # type: ignore[return-value]
    probes = entry["probes"]  # type: ignore[index]
    return probes[round_idx % len(probes)]


# ---------------------------------------------------------------------------
# Per-question driver — runs one full Q&A loop with probe rounds
# ---------------------------------------------------------------------------

MAX_TOTAL_TURNS_PER_QUESTION = 24  # safety ceiling: model + interviewee turns
ASSISTANT_BASE_INSTRUCTION = (
    "Speak in Chinese. Ask the interview question naturally as your first "
    "message; then conduct probe rounds; then call complete_question with the "
    "final consolidated answer. Use the tools `record_probe_round` and "
    "`complete_question` exactly as documented — do not invent other tools."
)


async def run_question(
    client: DeepSeekClient,
    question,
    section,
    log,
) -> QuestionRunStats:
    cfg = build_question_task_config(question, section)
    instructions = build_question_instructions(cfg)

    stats = QuestionRunStats(
        questionId=question.questionId,
        questionType=question.questionType,
        probeLevel=question.probeLevel,
        maxRounds=PROBE_DEFAULT_MAX_ROUNDS[question.probeLevel],
    )

    messages: list[dict] = [
        {"role": "system", "content": supervisor_system_prompt()},
        {"role": "system", "content": ASSISTANT_BASE_INSTRUCTION},
        {"role": "system", "content": instructions},
        {"role": "user", "content": "请按指引开始这道题。"},
    ]
    started = time.monotonic()
    main_answer_sent = False
    probe_round_idx = 0
    turns = 0

    while turns < MAX_TOTAL_TURNS_PER_QUESTION:
        turns += 1
        try:
            resp = await client.chat(messages, TOOLS)
        except httpx.HTTPError as e:
            stats.error = f"http: {e!s}"
            break
        usage = resp.get("usage", {})
        stats.inputTokens += usage.get("prompt_tokens", 0)
        stats.outputTokens += usage.get("completion_tokens", 0)
        choice = resp["choices"][0]
        msg = choice["message"]

        # Append assistant message verbatim (it may contain tool_calls + content).
        messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")})

        text_content = (msg.get("content") or "").strip()
        tool_calls = msg.get("tool_calls") or []

        # CASE 1: pure text — the model is asking a question or probing.
        if text_content and not tool_calls:
            if not main_answer_sent:
                stats.askedQuestion = text_content
                answer = fake_interviewee_answer(question.questionId, "main", 0)
                main_answer_sent = True
            else:
                stats.probeQuestions.append(text_content)
                answer = fake_interviewee_answer(
                    question.questionId, "probe", probe_round_idx
                )
                probe_round_idx += 1
            messages.append({"role": "user", "content": answer})
            continue

        # CASE 2: tool calls — process each
        if tool_calls:
            terminate = False
            for call in tool_calls:
                name = call["function"]["name"]
                try:
                    args = json.loads(call["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                tool_call_id = call["id"]

                if name == "record_probe_round":
                    pq = args.get("probe_question", "")
                    pa = args.get("probe_respondent_answer", "")
                    stats.actualRounds += 1
                    stats.probeQuestions.append(pq)
                    used = stats.actualRounds
                    cap = stats.maxRounds
                    if used >= cap:
                        tool_response = (
                            f"Recorded probe {used}/{cap}. "
                            "Probe limit reached — call complete_question now."
                        )
                    else:
                        tool_response = (
                            f"Recorded probe {used}/{cap}. "
                            "Ask another probe if useful, or call complete_question."
                        )
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": tool_response,
                    })
                elif name == "complete_question":
                    if stats.actualRounds < 1:
                        # Mirror the actual task: refuse premature completion.
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": (
                                "You must ask at least one probe before finishing. "
                                "Ask a follow-up question and call record_probe_round first."
                            ),
                        })
                        continue
                    stats.completedAnswer = args.get("respondent_answer", "")
                    stats.completed = True
                    terminate = True
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": "ok",
                    })
                else:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": f"unknown tool {name}",
                    })
            if terminate:
                break
            continue

        # Defensive: empty assistant message — feed a nudge.
        messages.append({
            "role": "user",
            "content": "请继续:你已经问过我主问题了吗?接下来的提问或 record_probe_round / complete_question?",
        })

    stats.elapsedSec = time.monotonic() - started
    if not stats.completed and stats.error is None:
        stats.error = f"did not call complete_question within {turns} turns"
    log(
        f"  [{question.questionId}] type={question.questionType:<13} "
        f"probe={question.probeLevel} rounds={stats.actualRounds}/{stats.maxRounds} "
        f"completed={stats.completed} elapsed={stats.elapsedSec:.1f}s "
        f"in_tokens={stats.inputTokens} out_tokens={stats.outputTokens}"
    )
    if stats.error:
        log(f"     ERROR: {stats.error}")
    return stats


# ---------------------------------------------------------------------------
# Survey-level driver
# ---------------------------------------------------------------------------

async def run_survey(quick: bool = False) -> SurveyRunStats:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY not set")

    run_id = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path("/tmp/merism") / f"cascade_pressure_{run_id}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def log(msg: str) -> None:
        print(msg, flush=True)

    survey_stats = SurveyRunStats(
        runId=run_id, model=DEEPSEEK_MODEL, startedAt=time.time()
    )
    started = time.monotonic()
    client = DeepSeekClient(api_key)

    # Flat list of (section, question) so quick-mode just slices.
    plan: list[tuple] = [
        (s, q) for s in LONG_RUNTIME_STUDY.sections for q in s.questions
    ]
    if quick:
        plan = plan[:5]

    log(f"=== cascade pressure run {run_id} ===")
    log(f"model={DEEPSEEK_MODEL}  questions={len(plan)}/{total_questions()}  quick={quick}")
    log(f"output: {out_path}")
    log("")

    current_section_id = None
    try:
        for section, question in plan:
            if section.sectionId != current_section_id:
                log(f"-- {section.title} --")
                current_section_id = section.sectionId
            qstats = await run_question(client, question, section, log)
            survey_stats.questions.append(qstats)
            survey_stats.totalInputTokens += qstats.inputTokens
            survey_stats.totalOutputTokens += qstats.outputTokens
    finally:
        await client.aclose()

    survey_stats.elapsedSec = time.monotonic() - started

    log("")
    log("=== summary ===")
    log(f"completion: {survey_stats.completedQuestions}/{len(survey_stats.questions)} "
        f"({survey_stats.completionRate * 100:.1f}%)")
    log(f"wall_clock: {survey_stats.elapsedSec:.1f}s = {survey_stats.elapsedSec / 60:.1f} min")
    log(f"tokens   : in={survey_stats.totalInputTokens}  out={survey_stats.totalOutputTokens}  "
        f"total={survey_stats.totalInputTokens + survey_stats.totalOutputTokens}")
    log(f"est cost : ${survey_stats.estimatedCostUsd:.4f}")

    failed = [q for q in survey_stats.questions if not q.completed]
    if failed:
        log(f"FAILED ({len(failed)}):")
        for q in failed:
            log(f"  - {q.questionId} type={q.questionType} reason={q.error}")

    out_path.write_text(json.dumps(survey_stats.to_dict(), ensure_ascii=False, indent=2))
    log(f"\nfull report: {out_path}")
    return survey_stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="run first 5 questions only")
    args = parser.parse_args()
    survey_stats = asyncio.run(run_survey(quick=args.quick))
    return 0 if survey_stats.completionRate == 1.0 else 1


if __name__ == "__main__":
    sys.exit(main())
