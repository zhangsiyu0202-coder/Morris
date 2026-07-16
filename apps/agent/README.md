# Merism Python Gemini Live video worker

This is the only production realtime interview worker. It uses the official
Python LiveKit Google plugin because that plugin forwards LiveKit camera and
screen-share tracks to Gemini Live with `RoomOptions(video_input=True)`. The
required `livekit-agents[google,images]` dependency includes Pillow, which the
plugin uses to JPEG-encode each forwarded frame.

The worker consumes `InterviewRoomMetadata`, fails closed when `flowConfig` is
missing, runs the declarative `FlowRunner`, publishes `merism.interviewState`,
accepts `merism.submit_answer`, records final transcripts, and calls only the
`finalizeInterviewSession` Function for persistence.

```bash
cd apps/agent
uv sync
uv run pytest
uv run python -m agent.main start
```

Required environment: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
and `GEMINI_API_KEY` or `GOOGLE_API_KEY`. `MERISM_VOICE_AGENT_NAME` defaults to
`merism-gemini-live-video-worker` in the dispatching Function.

See ADR-0019 for the migration decision and verification evidence.
