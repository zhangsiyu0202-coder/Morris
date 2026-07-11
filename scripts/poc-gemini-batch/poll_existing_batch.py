"""poll_existing_batch.py — 继续轮询 verify_gemini_batch.py 创建的 batch job 直到完成."""
import json, os, sys, time
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path("../../.env"))
from google import genai

JOB_NAME = "batches/er6yqf0q4pyynfzjmkm8nuz5oyfl4nr1isu8"
client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))

completed = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
t0 = time.monotonic()
while True:
    job = client.batches.get(name=JOB_NAME)
    elapsed = time.monotonic() - t0
    print(f"[{elapsed:5.0f}s] state={job.state.name}", flush=True)
    if job.state.name in completed:
        break
    if elapsed > 600:  # 10 min cap this run
        print("[TIMEOUT] this run, batch still running; rerun script later")
        sys.exit(0)
    time.sleep(20)

print(f"\n[FINAL] state={job.state.name}")
if job.state.name == "JOB_STATE_SUCCEEDED" and job.dest and job.dest.inlined_responses:
    out = []
    for i, r in enumerate(job.dest.inlined_responses):
        if r.response and r.response.candidates:
            text = ""
            try:
                text = r.response.candidates[0].content.parts[0].text or ""
            except Exception:
                pass
            usage = r.response.usage_metadata.model_dump() if r.response.usage_metadata else None
            out.append({"i": i, "text": text.strip(), "usage": usage, "error": None})
        else:
            err = str(r.error) if r.error else "no response"
            out.append({"i": i, "text": None, "usage": None, "error": err})
    Path("outputs/batch_results.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
    for o in out:
        print(f"  segment {o['i']}: {o['text'] or 'ERROR: ' + (o['error'] or '?')}")
