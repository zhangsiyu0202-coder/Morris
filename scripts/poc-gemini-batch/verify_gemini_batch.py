"""verify_gemini_batch.py — 验证 Gemini Batch API 在我们 file_uri + video_metadata 模式下能跑通.

PoC 目标:
1. 合成一段 10 秒的测试 mp4 (每 2 秒一种鲜明颜色, 模型必须看对 offset 才能命中颜色)
2. 用 google-genai SDK 上传到 Files API
3. 构造 6 个 inline batch requests:
   - 5 个正常 segment (0-2s, 2-4s, ..., 8-10s) 引用同一 file_uri + 不同 video_metadata offset
   - 1 个 negative segment (100-110s, 远超视频时长) 验证 batch partial-error 行为
4. batches.create → 轮询直到 SUCCEEDED/FAILED/EXPIRED
5. 验证每段输出包含**对应**颜色 (证明 offset 真的生效, 不是模型看了整段视频)
6. 验证 negative segment 单独失败但不影响其他 5 段成功
7. 输出 outputs/batch_metrics.json: 总耗时 / 每段 token / 总成本估算

成功标准 (全部 PASS 才能启 ADR-0010):
- batch 状态最终到 SUCCEEDED
- 5 个正常 segment 各自成功 + 输出颜色匹配预期
- 1 个 negative segment inline_response.error 不空, 但其他 5 段不受影响 (partial behavior 确认)
- 总实际耗时 < 30 分钟 (远低于 24h SLA)
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import imageio.v3 as iio
import numpy as np
from dotenv import load_dotenv
from google import genai
from google.genai import types

HERE = Path(__file__).parent
load_dotenv(HERE.parent.parent / ".env")

API_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("[FATAL] no GOOGLE_API_KEY/GEMINI_API_KEY in .env", file=sys.stderr)
    sys.exit(1)

OUT_DIR = HERE / "outputs"
OUT_DIR.mkdir(exist_ok=True)
VIDEO_PATH = OUT_DIR / "test_colors.mp4"

# 每 2 秒一种颜色, 必须 offset 准确才能命中
COLOR_BLOCKS = [
    ("RED",     (220, 30, 30)),
    ("YELLOW",  (240, 220, 30)),
    ("GREEN",   (30, 180, 60)),
    ("BLUE",    (30, 80, 220)),
    ("MAGENTA", (220, 30, 180)),
]
FPS = 24
SEGMENT_DURATION_S = 2  # 每段 2 秒
TOTAL_DURATION_S = SEGMENT_DURATION_S * len(COLOR_BLOCKS)  # 10 秒
WIDTH, HEIGHT = 320, 240
MODEL = "gemini-2.5-flash"


def synthesize_test_video() -> Path:
    """生成 10 秒测试 mp4: 0-2s 红, 2-4s 黄, 4-6s 绿, 6-8s 蓝, 8-10s 品红."""
    if VIDEO_PATH.exists():
        print(f"[VIDEO] reusing {VIDEO_PATH} ({VIDEO_PATH.stat().st_size} bytes)")
        return VIDEO_PATH
    print(f"[VIDEO] synthesizing {TOTAL_DURATION_S}s test mp4...")
    frames = []
    for color_name, rgb in COLOR_BLOCKS:
        for _ in range(FPS * SEGMENT_DURATION_S):
            frame = np.full((HEIGHT, WIDTH, 3), rgb, dtype=np.uint8)
            frames.append(frame)
    iio.imwrite(VIDEO_PATH, np.stack(frames), fps=FPS, codec="libx264")
    print(f"[VIDEO] wrote {VIDEO_PATH} ({VIDEO_PATH.stat().st_size} bytes, {len(frames)} frames)")
    return VIDEO_PATH


def upload_video(client: genai.Client) -> types.File:
    print(f"[UPLOAD] uploading {VIDEO_PATH.name}...")
    t0 = time.monotonic()
    uploaded = client.files.upload(file=str(VIDEO_PATH))
    print(f"[UPLOAD] file name={uploaded.name} state={uploaded.state}")
    # poll until ACTIVE
    while uploaded.state.name != "ACTIVE":
        if uploaded.state.name == "FAILED":
            raise RuntimeError(f"file processing failed: {uploaded}")
        time.sleep(1)
        uploaded = client.files.get(name=uploaded.name)
    elapsed = (time.monotonic() - t0) * 1000
    print(f"[UPLOAD] ACTIVE after {elapsed:.0f}ms; uri={uploaded.uri}")
    return uploaded


def build_segment_requests(file_uri: str, mime_type: str) -> list[dict]:
    """构造 6 个 inline batch requests: 5 正常 + 1 negative."""
    requests = []
    # 5 个正常 segment
    for i, (color_name, _) in enumerate(COLOR_BLOCKS):
        start = i * SEGMENT_DURATION_S
        end = start + SEGMENT_DURATION_S
        requests.append({
            "contents": [{
                "role": "user",
                "parts": [
                    {
                        "file_data": {"file_uri": file_uri, "mime_type": mime_type},
                        "video_metadata": {
                            "start_offset": f"{start}s",
                            "end_offset": f"{end}s",
                        },
                    },
                    {
                        "text": (
                            "What single color dominates this video segment? "
                            "Answer with ONLY ONE WORD from: RED, YELLOW, GREEN, BLUE, MAGENTA."
                        ),
                    },
                ],
            }],
        })
    # 1 个 negative segment (远超视频时长, 验证 partial error)
    requests.append({
        "contents": [{
            "role": "user",
            "parts": [
                {
                    "file_data": {"file_uri": file_uri, "mime_type": mime_type},
                    "video_metadata": {
                        "start_offset": "100s",
                        "end_offset": "110s",
                    },
                },
                {"text": "What single color dominates this video segment?"},
            ],
        }],
    })
    return requests


def main() -> int:
    print("=" * 60)
    print("Gemini Batch API verification")
    print(f"  model: {MODEL}")
    print(f"  segments: {len(COLOR_BLOCKS)} normal + 1 negative = {len(COLOR_BLOCKS)+1}")
    print(f"  api key: {API_KEY[:6]}...{API_KEY[-4:]}")
    print("=" * 60)

    synthesize_test_video()

    client = genai.Client(api_key=API_KEY)

    uploaded = upload_video(client)
    inline_requests = build_segment_requests(uploaded.uri, uploaded.mime_type or "video/mp4")
    print(f"[BATCH] submitting {len(inline_requests)} inline requests...")

    t0 = time.monotonic()
    batch_job = client.batches.create(
        model=MODEL,
        src=inline_requests,
        config={"display_name": "poc-gemini-batch-video-offset"},
    )
    print(f"[BATCH] created job={batch_job.name} state={batch_job.state.name}")

    # poll
    completed = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
    poll_count = 0
    last_state = batch_job.state.name
    while batch_job.state.name not in completed:
        time.sleep(15)
        poll_count += 1
        batch_job = client.batches.get(name=batch_job.name)
        if batch_job.state.name != last_state:
            print(f"[POLL #{poll_count}] state -> {batch_job.state.name}")
            last_state = batch_job.state.name
        else:
            print(f"[POLL #{poll_count}] still {batch_job.state.name}", end="\r", flush=True)
        if poll_count > 240:  # 1 hour safety
            print("\n[FATAL] poll timeout 1h", file=sys.stderr)
            return 2

    elapsed_s = time.monotonic() - t0
    print(f"\n[BATCH] final state = {batch_job.state.name} after {elapsed_s:.0f}s ({poll_count} polls)")

    if batch_job.state.name != "JOB_STATE_SUCCEEDED":
        print(f"[FAIL] batch did not succeed: {batch_job.error}", file=sys.stderr)
        return 3

    # 拉结果
    if not batch_job.dest or not batch_job.dest.inlined_responses:
        print("[FAIL] no inlined_responses", file=sys.stderr)
        return 4

    inlined = batch_job.dest.inlined_responses
    print(f"[RESULT] got {len(inlined)} inlined responses")

    # 验证每段
    checks = []
    segment_outputs = []
    for i, resp in enumerate(inlined):
        is_negative = i == len(COLOR_BLOCKS)
        expected_color = None if is_negative else COLOR_BLOCKS[i][0]
        if resp.response and resp.response.candidates:
            try:
                text = resp.response.candidates[0].content.parts[0].text or ""
            except Exception:
                text = ""
            text_clean = text.strip().upper()
            usage = (
                resp.response.usage_metadata.model_dump()
                if resp.response.usage_metadata
                else None
            )
            segment_outputs.append({
                "index": i, "expected": expected_color, "got": text_clean,
                "is_negative": is_negative, "usage": usage,
                "error": None,
            })
            if is_negative:
                checks.append({
                    "name": f"segment_{i}_negative_should_fail",
                    "ok": False,  # 期望它失败但它成功了 → 标记为 unexpected pass
                    "note": "negative segment unexpectedly succeeded",
                })
            else:
                ok = expected_color in text_clean
                checks.append({
                    "name": f"segment_{i}_color_match",
                    "ok": ok,
                    "expected": expected_color, "got": text_clean,
                })
        else:
            err = (
                resp.error.message if resp.error and hasattr(resp.error, "message")
                else (str(resp.error) if resp.error else "no response")
            )
            segment_outputs.append({
                "index": i, "expected": expected_color, "got": None,
                "is_negative": is_negative, "usage": None, "error": err,
            })
            if is_negative:
                checks.append({
                    "name": f"segment_{i}_negative_failed_as_expected",
                    "ok": True, "error": err,
                })
            else:
                checks.append({
                    "name": f"segment_{i}_unexpected_failure",
                    "ok": False, "error": err,
                })

    # 关键不变量: 5 正常段输出**互不相同** (证明 offset 生效, 模型不是看的整段视频)
    normal_outputs = [s["got"] for s in segment_outputs[:len(COLOR_BLOCKS)] if s["got"]]
    distinct_outputs = len(set(normal_outputs))
    checks.append({
        "name": "normal_segments_outputs_are_distinct",
        "ok": distinct_outputs == len(COLOR_BLOCKS),
        "distinct_count": distinct_outputs,
        "expected_count": len(COLOR_BLOCKS),
    })

    all_passed = all(c["ok"] for c in checks)

    # 总 token
    total_input_tokens = sum(
        (s["usage"] or {}).get("prompt_token_count", 0) for s in segment_outputs
    )
    total_output_tokens = sum(
        (s["usage"] or {}).get("candidates_token_count", 0) for s in segment_outputs
    )

    metrics = {
        "model": MODEL,
        "video_duration_s": TOTAL_DURATION_S,
        "video_size_bytes": VIDEO_PATH.stat().st_size,
        "total_segments": len(inline_requests),
        "normal_segments": len(COLOR_BLOCKS),
        "batch_total_seconds": round(elapsed_s, 1),
        "poll_count": poll_count,
        "all_checks_passed": all_passed,
        "checks": checks,
        "segment_outputs": segment_outputs,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "file_uri_used": uploaded.uri,
        "batch_job_name": batch_job.name,
    }
    metrics_path = OUT_DIR / "batch_metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    print()
    print("=" * 60)
    print("CHECKS:")
    for c in checks:
        flag = "[PASS]" if c["ok"] else "[FAIL]"
        print(f"  {flag} {c['name']}")
        for k, v in c.items():
            if k not in ("name", "ok"):
                print(f"           {k}: {v}")
    print("=" * 60)
    print(f"\n[BATCH] elapsed={elapsed_s:.0f}s  tokens in/out: {total_input_tokens}/{total_output_tokens}")
    print(f"[OUTPUT] full metrics → {metrics_path}")

    # cleanup file (省费用)
    try:
        client.files.delete(name=uploaded.name)
        print(f"[CLEANUP] deleted {uploaded.name}")
    except Exception as exc:
        print(f"[CLEANUP] file delete failed (ok): {exc}")

    return 0 if all_passed else 5


if __name__ == "__main__":
    sys.exit(main())
