# MerismV2 Agent Worker

Python LiveKit Agent Worker that hosts the Supervisor / TaskGroup / AgentTask
voice interview workflow.

The worker reads room metadata (set by `issueLivekitToken`) on join and routes:

- **runtimeStudy/workflowConfig + provider creds present** → full voice
  interview: an `AgentSession` (Qwen ASR/TTS + DeepSeek LLM) driven by the
  `InterviewSupervisorAgent`, which walks each section as a LiveKit `TaskGroup`
  (one `AgentTask` per question), publishes live `InterviewAgentState` for the
  frontend, and streams transcript/results to Appwrite.
- **runtimeStudy/workflowConfig but no provider creds** → UI-only RPC bridge
  (frontend submits answers, agent advances state).
- **otherwise** → idle.

## Architecture

| Module | Responsibility | Realtime deps? |
|--------|----------------|----------------|
| `agent/main.py` | Entrypoint + routing | lazy |
| `agent/interview/engine.py` | Builds `AgentSession`, wires transcription, starts supervisor | lazy |
| `agent/interview/supervisor.py` | Long-lived agent: section/question loop, state publish, persistence | lazy |
| `agent/interview/workflow.py` | **Pure** config resolution + state transitions | none |
| `agent/interview/transcript.py` | **Pure** transcript buffer | none |
| `agent/providers/` | DeepSeek (LLM) + Qwen (ASR/TTS) adapters; pluggable speech backend | settings pure, factories lazy |
| `agent/persistence/` | Appwrite repository + **pure** serializers | SDK lazy |

Correctness-bearing logic lives in pure modules (`workflow`, `transcript`,
`serializers`) so it is unit tested without the realtime stack. The realtime
modules only orchestrate livekit and delegate state to the pure layer.

## Setup

```bash
cd apps/agent
uv sync                    # core deps + dev/test tools (fast, no livekit)
uv sync --extra realtime   # adds livekit-agents + openai/silero plugins (to run the agent)
```

> The `livekit-plugins-openai` plugin is a **generic OpenAI-protocol client**.
> It is **not** used against OpenAI: it is pointed at DeepSeek (LLM) and
> DashScope/Qwen (ASR/TTS) `base_url`s. No OpenAI key is needed.

## Run

```bash
uv run python -m agent.main dev   # connects to LiveKit, runs the interview engine
```

## Test

```bash
uv run pytest            # or, from repo root: pnpm test:py
```

## Environment variables

| Var | Purpose |
|-----|---------|
| `LIVEKIT_URL` | LiveKit server ws URL |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Agent worker auth to LiveKit |
| `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY` | Server SDK access (persistence) |
| `DEEPSEEK_API_KEY` | DeepSeek LLM key (required for voice engine) |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | Override DeepSeek endpoint/model (optional) |
| `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | Qwen ASR/TTS key (required for voice engine) |
| `QWEN_BASE_URL` / `QWEN_ASR_MODEL` / `QWEN_TTS_MODEL` / `QWEN_TTS_VOICE` | Override Qwen endpoint/models (optional) |
| `QWEN_SPEECH_BACKEND` | `openai` (default) or `dashscope` (reserved) |
| `QWEN_LANGUAGE` / `INTERVIEW_LANGUAGE` | ASR/interview language (default `zh`) |
| `STT_PROVIDER_KEY` / `TTS_PROVIDER_KEY` | Optional provider-specific aliases |

If `DEEPSEEK_API_KEY` **and** `QWEN_API_KEY` are not both present, the worker
falls back to the UI-only RPC bridge. If Appwrite creds are absent, the
interview still runs but results are not persisted.

See repo-root `.env.example` for the full list.
