import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { initializeLogger } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";

import { resolveDashScopeSpeechConfig } from "../src/mastra/dashscope-config";
import { DashScopeFunAsrFlashSTT } from "../src/mastra/dashscope-funasr-flash-stt";

const DEFAULT_PCM_PATH = resolve(process.cwd(), "../../scripts/poc-omni-realtime/outputs/tts_001_16k.pcm");

async function main() {
  initializeLogger({ pretty: false, level: "silent" });

  const pcmPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PCM_PATH;
  const bytes = readFileSync(pcmPath);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  // Feed the whole clip as one utterance — in production LiveKit's StreamAdapter
  // (silero VAD) cuts utterances and calls recognize() per segment.
  const frame = new AudioFrame(samples, 16000, 1, samples.length);

  const config = resolveDashScopeSpeechConfig();
  const sttProvider = new DashScopeFunAsrFlashSTT(config);
  const started = Date.now();
  const event = await sttProvider.recognize(frame);
  const latencyMs = Date.now() - started;

  console.log(
    JSON.stringify(
      {
        model: config.funAsrFlashModel,
        endpoint: config.funAsrFlashHttpEndpoint,
        pcmPath,
        sampleCount: samples.length,
        latencyMs,
        transcript: event.alternatives?.[0]?.text ?? "",
      },
      null,
      2,
    ),
  );
}

await main();
