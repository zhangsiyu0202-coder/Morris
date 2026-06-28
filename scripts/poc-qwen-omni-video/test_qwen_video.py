#!/usr/bin/env python3
"""Real end-to-end test of the qwen_video wrapper.

Exercises the full seam (upload_local_video -> analyze_oss_video) through the
public analyze_video() entry point, with the real DASHSCOPE_API_KEY, on:
  1. the synthesized 10s colour clip (deterministic content check)
  2. the real 18MB egress recording (real interview-recording shape)

Also asserts the wrapper's structural guarantees: typed result, oss:// url,
non-empty text, and that error classification maps a bad path to Permanent.

Run:
    set -a; source ../../.env; set +a
    python3 test_qwen_video.py
"""
import os
import sys

from qwen_video import (
    PermanentProviderError,
    QwenVideoConfig,
    VideoAnalysisResult,
    analyze_video,
    config_from_env,
)

COLOR_CLIP = "/home/jia/MerismV2/scripts/poc-gemini-batch/outputs/test_colors.mp4"
REAL_REC = "/home/jia/MerismV2/infra/docker/egress/s_6a3008180024824ce83b_0.mp4"

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"  [{PASS if cond else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    return cond


def main() -> int:
    try:
        config = config_from_env()
    except PermanentProviderError as e:
        print(f"{FAIL} env: {e}")
        return 1
    print(f"model = {config.model}\n")

    ok = True

    # --- Test 1: colour clip, deterministic content -------------------------
    print("=== Test 1: colour clip (content correctness) ===")
    r1 = analyze_video(
        config,
        COLOR_CLIP,
        "这段视频按时间先后出现了哪几种颜色？只列颜色，用中文。",
    )
    ok &= check("returns VideoAnalysisResult", isinstance(r1, VideoAnalysisResult))
    ok &= check("oss:// url", r1.oss_url.startswith("oss://"), r1.oss_url[:48] + "...")
    ok &= check("non-empty text", r1.char_count > 0, f"{r1.char_count} chars")
    # The clip is RED->YELLOW->GREEN->BLUE->MAGENTA. Require >=3 colour hits.
    hits = [c for c in ("红", "黄", "绿", "蓝", "紫", "粉") if c in r1.text]
    ok &= check("reads colour sequence", len(hits) >= 3, f"hits={hits}")
    print(f"      text: {r1.text[:120]}\n")

    # --- Test 2: real 18MB recording (real shape, oss path) -----------------
    print("=== Test 2: real 18MB recording (large-file oss path) ===")
    r2 = analyze_video(
        config,
        REAL_REC,
        "请用中文简要描述这段录像的画面和音频内容。",
    )
    ok &= check("oss:// url", r2.oss_url.startswith("oss://"))
    ok &= check("substantial analysis", r2.char_count > 100, f"{r2.char_count} chars")
    print(f"      text: {r2.text[:160]}...\n")

    # --- Test 3: error classification (bad path -> Permanent) ---------------
    print("=== Test 3: error classification ===")
    try:
        analyze_video(config, "/nonexistent/nope.mp4", "x")
        ok &= check("bad path raises Permanent", False, "no error raised")
    except PermanentProviderError:
        ok &= check("bad path raises Permanent", True)
    except Exception as e:  # noqa: BLE001
        ok &= check("bad path raises Permanent", False, f"got {type(e).__name__}")

    print()
    if ok:
        print(f"{PASS} all checks passed — wrapper seam works end-to-end")
        return 0
    print(f"{FAIL} some checks failed")
    return 1


if __name__ == "__main__":
    sys.exit(main())
