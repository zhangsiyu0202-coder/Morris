"""Shared pytest fixtures for apps/agent test suites.

Only put fixtures here that are genuinely cross-cutting. Per-module fixtures
stay next to their tests.
"""
from __future__ import annotations

import asyncio

import pytest


@pytest.fixture(autouse=False)
def fresh_event_loop():
    """Provide a fresh asyncio event loop for the duration of one test.

    Why this is needed:
    - LiveKit ``AgentTask.__init__`` constructs ``asyncio.Future[...]``
      during instantiation, which requires a current event loop to bind to.
    - Python 3.12 elevates the legacy ``get_event_loop`` deprecation to
      ``RuntimeError`` whenever no loop is set on the current thread, so a
      prior ``asyncio.run(...)`` that closes the global loop will make the
      next test crash if it touches ``asyncio.Future`` (or anything that
      calls ``get_event_loop`` internally).

    Cleanup deliberately attaches a *new* (open) loop to the thread rather
    than clearing the policy with ``set_event_loop(None)``, because
    downstream test files (notably ``test_livekit_smoke.py``) also touch
    ``asyncio.Future`` at ``AgentTask.__init__`` time without an
    ``asyncio.run`` wrapper. Without leaving a loop attached we would crash
    those subsequent tests with the same RuntimeError.

    This fixture is opt-in (``autouse=False``). Tests that need it should
    declare it explicitly via ``@pytest.mark.usefixtures("fresh_event_loop")``
    or by accepting ``fresh_event_loop`` as a function argument when they
    want the loop handle. Keeping it opt-in avoids forcing existing pure
    sync tests to spin up a loop they do not need.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        yield loop
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())
