# MerismV2 Agent Worker

Python LiveKit Agent Worker that hosts the Supervisor / TaskGroup / AgentTask
voice interview workflow.
This package is the **foundation skeleton** — hello-world agent only, no STT/TTS.

## Setup

```bash
cd apps/agent
uv sync                 # core deps + dev/test tools
uv sync --extra realtime  # adds livekit-agents (needed to run the agent)
```

## Run

```bash
uv run python -m agent.main dev   # connects to LiveKit, logs sessionId on join
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
| `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY` | Server SDK access |
| `QWEN_API_KEY` | Qwen ASR/TTS provider key (later sub-spec) |
| `DEEPSEEK_API_KEY` | DeepSeek LLM provider key (later sub-spec) |
| `STT_PROVIDER_KEY` / `TTS_PROVIDER_KEY` | Optional provider-specific aliases |

See repo-root `.env.example` for the full list.
