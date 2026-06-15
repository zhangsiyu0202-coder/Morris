"""Regression tests for ``EgressRecorder._resolve_local_path``.

The container writes recordings to ``output_dir`` (e.g. ``/out``) which is
bind-mounted from ``local_mount`` on the host. The location returned by
LiveKit egress is the container path (``/out/<file>.mp4``), but the host file
sits directly under ``local_mount`` with no ``out/`` subdir. This module
pins down the strip-prefix-then-join behaviour so a future refactor cannot
silently break the mp4 resolution path.
"""
import pytest

from agent.interview.egress_recorder import EgressRecorder, EgressSettings


def _make(local_mount: str | None, output_dir: str = "/out") -> EgressRecorder:
    settings = EgressSettings(
        livekit_url="ws://x:7880",
        api_key="k",
        api_secret="s",
        output_dir=output_dir,
        local_mount=local_mount,
    )
    return EgressRecorder(settings, logger=None)


def test_strips_container_output_dir_prefix() -> None:
    rec = _make("/home/jia/MerismV2/infra/docker/egress")
    assert (
        rec._resolve_local_path("/out/abc.mp4", "abc.mp4")
        == "/home/jia/MerismV2/infra/docker/egress/abc.mp4"
    )


def test_preserves_subdirs_under_output_dir() -> None:
    rec = _make("/home/jia/MerismV2/infra/docker/egress")
    assert (
        rec._resolve_local_path("/out/2026/abc.mp4", "abc.mp4")
        == "/home/jia/MerismV2/infra/docker/egress/2026/abc.mp4"
    )


def test_handles_basename_only_when_no_dir() -> None:
    rec = _make("/mnt/egress")
    assert rec._resolve_local_path("foo.mp4", "foo.mp4") == "/mnt/egress/foo.mp4"


def test_handles_absolute_non_output_path_via_basename() -> None:
    rec = _make("/mnt/egress")
    # Outside the configured output_dir; defensive fall back to basename.
    assert (
        rec._resolve_local_path("/var/data/foo.mp4", "foo.mp4")
        == "/mnt/egress/var/data/foo.mp4"
    )


def test_returns_absolute_when_no_local_mount() -> None:
    rec = _make(local_mount=None)
    assert rec._resolve_local_path("/out/foo.mp4", "foo.mp4") == "/out/foo.mp4"


def test_returns_none_when_no_mount_and_relative() -> None:
    rec = _make(local_mount=None)
    assert rec._resolve_local_path("foo.mp4", "foo.mp4") is None
