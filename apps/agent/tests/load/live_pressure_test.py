"""Gemini Live API pressure test — drives the same 20-question survey through
a direct WSS session in AUDIO modality with function-tool calls.

Architecture difference from cascade_pressure_test.py:
- WSS to generativelanguage.googleapis.com/ws/...BidiGenerateContent
- modalities=["AUDIO"] (native-audio model: only AUDIO out is supported, but
  TEXT input via client_content is fine and tools work alongside)
- output_audio_transcription enabled so we capture the model's speech as text
- Tool definitions same shape as cascade (record_probe_round + complete_question)
- For each question we send the per-question instructions as system_instruction
  via setup, then advance via client_content text turns

Cost expectation: audio output billed at $12/M tokens × 25 tok/sec ≈ $0.018/min
of agent talk. 20 questions × ~30 sec/question ≈ $0.18 / run + small input
cost. Compare to cascade $0.033.

Run:
    cd apps/agent
    uv run python -m tests.load.live_pressure_test [--quick] [--questions N]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import websockets

from agent.contracts import ProbeConfig, QuestionTaskConfig, QuestionType
from agent.interview.tasks.question import build_question_instructions

from tests.load.long_survey_fixture import (
    LONG_RUNTIME_STUDY,
    SCRIPTED_ANSWERS,
    total_questions,
)


# ---------------------------------------------------------------------------
# Live API endpoint + model
# ---------------------------------------------------------------------------

LIVE_MODEL = os.environ.get(
    "GEMINI_REALTIME_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"
)
LIVE_ENDPOINT_FMT = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    "?key={key}"
)
PROBE_DEFAULT_MAX_ROUNDS = {"standard": 3, "deep": 5}

# Audio output: PCM 24 kHz 16-bit mono => 48000 bytes/sec.
AUDIO_BYTES_PER_SEC = 48000
# Pricing for audio output, see ai.google.dev/gemini-api/docs/pricing
# (gemini-2.5-flash-native-audio): $12 / 1M tokens, 25 tokens/sec audio.
LIVE_AUDIO_OUT_USD_PER_SEC = 12 * 25 / 1_000_000  # $0.0003/sec = $0.018/min
LIVE_TEXT_IN_USD_PER_TOKEN = 0.50 / 1_000_000
LIVE_TEXT_OUT_USD_PER_TOKEN = 2.00 / 1_000_000  # transcript counts as text out


# Function declarations in Gemini's native shape (different from OpenAI tools).
LIVE_TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "record_probe_round",
                "description": (
                    "Record one probe exchange (a follow-up question and its answer)."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "probe_question": {"type": "STRING"},
                        "probe_respondent_answer": {"type": "STRING"},
                    },
                    "required": ["probe_question", "probe_respondent_answer"],
                },
            },
            {
                "name": "complete_question",
                "description": (
                    "Finish this question with the consolidated answer to the "
                    "main question. Call after at least one probe round."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "respondent_answer": {"type": "STRING"},
                    },
                    "required": ["respondent_answer"],
                },
            },
        ]
    }
]


# ---------------------------------------------------------------------------
# Stats
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
    audioOutBytes: int = 0
    audioOutSec: float = 0.0
    transcriptOut: str = ""
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
    totalAudioOutSec: float = 0.0
    totalAudioOutBytes: int = 0
    totalTranscriptChars: int = 0
    questions: list[QuestionRunStats] = field(default_factory=list)

    @property
    def completedQuestions(self) -> int:
        return sum(1 for q in self.questions if q.completed)

    @property
    def completionRate(self) -> float:
        return self.completedQuestions / max(1, len(self.questions))

    @property
    def estimatedCostUsd(self) -> float:
        return self.totalAudioOutSec * LIVE_AUDIO_OUT_USD_PER_SEC

    def to_dict(self) -> dict:
        d = asdict(self)
        d["completedQuestions"] = self.completedQuestions
        d["completionRate"] = self.completionRate
        d["estimatedCostUsd"] = self.estimatedCostUsd
        d["totalQuestions"] = len(self.questions)
        return d


# ---------------------------------------------------------------------------
# WSS protocol helpers
# ---------------------------------------------------------------------------

def supervisor_system_prompt() -> str:
    s = LONG_RUNTIME_STUDY
    return (
        f"You are an AI qualitative interviewer for the study \"{s.studyTitle}\".\n"
        f"Research goal: {s.researchGoal}\n"
        f"Target audience: {s.targetAudience}\n"
        f"Opening script: {s.introScript}\n"
        "Speak Mandarin Chinese. Conduct the interview question by question, "
        "keep it conversational, ask probes when guidance is given, and never "
        "read out stage directions. Use the tools record_probe_round and "
        "complete_question exactly as documented."
    )


def build_question_task_config(question) -> QuestionTaskConfig:
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
    entry = SCRIPTED_ANSWERS[question_id]
    if kind == "main":
        return entry["main"]  # type: ignore[return-value]
    probes = entry["probes"]  # type: ignore[index]
    return probes[round_idx % len(probes)]


async def send_setup(ws, system_instruction: str) -> None:
    """Open the Live session with our model, tools, transcription, modality."""
    msg = {
        "setup": {
            "model": f"models/{LIVE_MODEL}",
            "generation_config": {
                "response_modalities": ["AUDIO"],
                "temperature": 0.7,
            },
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "tools": LIVE_TOOLS,
            "input_audio_transcription": {},
            "output_audio_transcription": {},
            "context_window_compression": {"sliding_window": {}},
        }
    }
    await ws.send(json.dumps(msg))
    # Expect setupComplete
    raw = await asyncio.wait_for(ws.recv(), timeout=15)
    parsed = json.loads(raw)
    if "setupComplete" not in parsed:
        raise RuntimeError(f"unexpected setup response: {parsed}")


async def send_initial_user_text(ws, text: str) -> None:
    """Seed the conversation history at start. client_content is only allowed
    before the first model turn on native-audio Live; afterwards use
    send_user_text_realtime."""
    msg = {
        "client_content": {
            "turns": [{"role": "user", "parts": [{"text": text}]}],
            "turn_complete": True,
        }
    }
    await ws.send(json.dumps(msg))


async def send_user_text(ws, text: str) -> None:
    """Mid-session user-turn text. Native-audio Live API rejects client_content
    after the first model turn ("Operation is not implemented" 1008), so we use
    realtime_input.text which is the documented incremental update channel."""
    msg = {"realtime_input": {"text": text}}
    await ws.send(json.dumps(msg))


async def send_tool_response(ws, function_call_id: str, name: str, response_obj: dict) -> None:
    msg = {
        "tool_response": {
            "function_responses": [
                {
                    "id": function_call_id,
                    "name": name,
                    "response": response_obj,
                }
            ]
        }
    }
    await ws.send(json.dumps(msg))


# ---------------------------------------------------------------------------
# Per-question driver
# ---------------------------------------------------------------------------

MAX_TURNS_PER_QUESTION = 16
PER_TURN_RECV_TIMEOUT_SEC = 60


async def run_question(ws, question, log) -> QuestionRunStats:
    cfg = build_question_task_config(question)
    instructions = build_question_instructions(cfg)

    stats = QuestionRunStats(
        questionId=question.questionId,
        questionType=question.questionType,
        probeLevel=question.probeLevel,
        maxRounds=PROBE_DEFAULT_MAX_ROUNDS[question.probeLevel],
    )
    started = time.monotonic()

    # Per-question kick. The first question uses client_content (initial
    # history seed); subsequent questions use realtime_input.text.
    if question.questionId == "sec_1_q1":
        await send_initial_user_text(
            ws, instructions + "\n\n请按上面 instructions 开始这道题。"
        )
    else:
        await send_user_text(
            ws, instructions + "\n\n请按上面 instructions 开始下一道题。"
        )

    main_answer_sent = False
    probe_round_idx = 0
    turn_audio_bytes = 0
    turn_transcript_parts: list[str] = []
    turn_tool_calls: list[dict] = []
    turns_processed = 0

    while turns_processed < MAX_TURNS_PER_QUESTION:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=PER_TURN_RECV_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            stats.error = "wss recv timeout"
            break
        except websockets.ConnectionClosed as e:
            stats.error = f"wss closed: {e!s}"
            break

        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue

        # Tool call from the model
        if "toolCall" in msg:
            for fc in msg["toolCall"].get("functionCalls", []):
                turn_tool_calls.append(fc)

        # Server content (audio / transcript / turn_complete)
        sc = msg.get("serverContent")
        if sc:
            if "modelTurn" in sc:
                for part in sc["modelTurn"].get("parts", []):
                    inline = part.get("inlineData")
                    if inline and inline.get("mimeType", "").startswith("audio/"):
                        # base64 size hint; actual bytes counted by length
                        try:
                            import base64
                            audio_bytes = base64.b64decode(inline.get("data", ""))
                            turn_audio_bytes += len(audio_bytes)
                        except Exception:
                            pass
            if "outputTranscription" in sc:
                txt = sc["outputTranscription"].get("text", "")
                if txt:
                    turn_transcript_parts.append(txt)
            if sc.get("turnComplete") or sc.get("generationComplete"):
                turns_processed += 1
                # end-of-turn: process accumulated content
                turn_text = "".join(turn_transcript_parts).strip()
                stats.audioOutBytes += turn_audio_bytes
                stats.audioOutSec += turn_audio_bytes / AUDIO_BYTES_PER_SEC
                stats.transcriptOut += (turn_text + "\n") if turn_text else ""

                # 1) tool calls in this turn
                terminate = False
                if turn_tool_calls:
                    for fc in turn_tool_calls:
                        name = fc.get("name", "")
                        args = fc.get("args", {}) or {}
                        if name == "record_probe_round":
                            stats.actualRounds += 1
                            stats.probeQuestions.append(args.get("probe_question", ""))
                            cap = stats.maxRounds
                            used = stats.actualRounds
                            tool_msg = (
                                f"Recorded probe {used}/{cap}. "
                                + ("Probe limit reached — call complete_question now."
                                   if used >= cap else
                                   "Ask another probe if useful, or call complete_question.")
                            )
                            await send_tool_response(ws, fc.get("id", ""), name, {"output": tool_msg})
                        elif name == "complete_question":
                            if stats.actualRounds < 1:
                                await send_tool_response(
                                    ws, fc.get("id", ""), name,
                                    {"output": "You must ask at least one probe before finishing."}
                                )
                                continue
                            stats.completedAnswer = args.get("respondent_answer", "")
                            stats.completed = True
                            await send_tool_response(ws, fc.get("id", ""), name, {"output": "ok"})
                            terminate = True
                        else:
                            await send_tool_response(
                                ws, fc.get("id", ""), name, {"output": f"unknown tool {name}"}
                            )

                # 2) plain spoken text — treat as the model's question / probe to interviewee
                elif turn_text:
                    if not main_answer_sent:
                        stats.askedQuestion = turn_text
                        answer = fake_interviewee_answer(question.questionId, "main", 0)
                        main_answer_sent = True
                    else:
                        stats.probeQuestions.append(turn_text)
                        answer = fake_interviewee_answer(
                            question.questionId, "probe", probe_round_idx
                        )
                        probe_round_idx += 1
                    await send_user_text(ws, answer)

                # 3) empty turn — nudge
                else:
                    if not main_answer_sent:
                        # Model produced nothing — send a kick so it asks the question.
                        await send_user_text(ws, "请开始这道题。")
                    else:
                        # Otherwise just wait for the next event without sending.
                        pass

                if terminate:
                    break
                turn_audio_bytes = 0
                turn_transcript_parts = []
                turn_tool_calls = []

    stats.elapsedSec = time.monotonic() - started
    if not stats.completed and stats.error is None:
        stats.error = f"did not call complete_question within {turns_processed} turns"
    log(
        f"  [{question.questionId}] type={question.questionType:<13} "
        f"probe={question.probeLevel} rounds={stats.actualRounds}/{stats.maxRounds} "
        f"completed={stats.completed} elapsed={stats.elapsedSec:.1f}s "
        f"audio_out={stats.audioOutSec:.1f}s"
    )
    if stats.error:
        log(f"     ERROR: {stats.error}")
    return stats


# ---------------------------------------------------------------------------
# Survey-level driver
# ---------------------------------------------------------------------------

async def run_survey(quick: bool = False, max_questions: int | None = None) -> SurveyRunStats:
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GOOGLE_API_KEY (or GEMINI_API_KEY) not set")

    run_id = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path("/tmp/merism") / f"live_pressure_{run_id}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def log(msg: str) -> None:
        print(msg, flush=True)

    survey_stats = SurveyRunStats(
        runId=run_id, model=LIVE_MODEL, startedAt=time.time()
    )

    plan: list[tuple] = [
        (s, q) for s in LONG_RUNTIME_STUDY.sections for q in s.questions
    ]
    if quick:
        plan = plan[:3]
    if max_questions is not None:
        plan = plan[:max_questions]

    log(f"=== live pressure run {run_id} ===")
    log(f"model={LIVE_MODEL}  questions={len(plan)}/{total_questions()}  quick={quick}")
    log(f"output: {out_path}")
    log("")

    started = time.monotonic()
    url = LIVE_ENDPOINT_FMT.format(key=api_key)
    try:
        async with websockets.connect(url, open_timeout=20, max_size=2**24) as ws:
            await send_setup(ws, supervisor_system_prompt())
            log("WSS setup complete")

            current_section_id = None
            for section, question in plan:
                if section.sectionId != current_section_id:
                    log(f"-- {section.title} --")
                    current_section_id = section.sectionId
                qstats = await run_question(ws, question, log)
                survey_stats.questions.append(qstats)
                survey_stats.totalAudioOutSec += qstats.audioOutSec
                survey_stats.totalAudioOutBytes += qstats.audioOutBytes
                survey_stats.totalTranscriptChars += len(qstats.transcriptOut)
    except Exception as e:
        log(f"!! survey aborted: {e!s}")

    survey_stats.elapsedSec = time.monotonic() - started

    log("")
    log("=== summary ===")
    log(f"completion : {survey_stats.completedQuestions}/{len(survey_stats.questions)} "
        f"({survey_stats.completionRate * 100:.1f}%)")
    log(f"wall_clock : {survey_stats.elapsedSec:.1f}s = {survey_stats.elapsedSec / 60:.1f} min")
    log(f"audio_out  : {survey_stats.totalAudioOutSec:.1f}s "
        f"({survey_stats.totalAudioOutBytes/1024/1024:.2f} MB)")
    log(f"transcript : {survey_stats.totalTranscriptChars} chars")
    log(f"est cost   : ${survey_stats.estimatedCostUsd:.4f}  "
        f"(audio out only, ${LIVE_AUDIO_OUT_USD_PER_SEC:.6f}/sec)")

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
    parser.add_argument("--quick", action="store_true", help="run first 3 questions only")
    parser.add_argument("--questions", type=int, default=None, help="cap questions")
    args = parser.parse_args()
    survey_stats = asyncio.run(run_survey(quick=args.quick, max_questions=args.questions))
    return 0 if survey_stats.completionRate == 1.0 else 1


if __name__ == "__main__":
    sys.exit(main())
