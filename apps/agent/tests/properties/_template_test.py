"""Hypothesis PBT template — copy into apps/agent/tests/properties/ for a
sub-spec. Name the property (P-XXX-NN) and reference foundation-setup/design.md
§Correctness Properties.
"""
from hypothesis import given
from hypothesis import strategies as st

from agent.retry import TransientProviderError, with_retry


@given(st.integers(min_value=1, max_value=5))
def test_with_retry_attempts_bounded(max_attempts):
    """Property: with_retry calls the fn at most max_attempts times."""
    calls = {"n": 0}

    def always_transient():
        calls["n"] += 1
        raise TransientProviderError("x")

    try:
        with_retry(always_transient, max_attempts=max_attempts, sleep=lambda _: None)
    except TransientProviderError:
        pass
    assert calls["n"] == max_attempts
