"""Long-running pressure tests for the realtime interview engine.

These do NOT run as part of `pnpm test:py` — they hit real provider APIs
(DeepSeek + Qwen + Gemini Live), take 15+ minutes per run, and incur cost.
Run individually:

    cd apps/agent
    uv run python -m tests.load.cascade_pressure_test
    uv run python -m tests.load.live_pressure_test

See docs in each module for cost / runtime expectations.
"""
