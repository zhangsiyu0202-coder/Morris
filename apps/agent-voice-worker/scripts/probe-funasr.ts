import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { initializeLogger, stt } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";

import { resolveDashScopeSpeechConfig } from "../src/mastra/dashscope-config";
import { DashScopeFunAsrRealtimeSTT } from "../src/mastra/dashscope-funasr-stt";

const DEFAULT_PCM_PATH = resolve(process.cwd(), "../../scripts/poc-omni-realtime/outputs/tts_001_16k.pcm");
const FRAME_SAMPLES = 1600;

function loadPcmFrames(filePath: string) {
  const bytes = readFileSync(filePath);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const frames: AudioFrame[] = [];

  for (let offset = 0; offset < samples.length; offset += FRAME_SAMPLES) {
    const chunk = samples.slice(offset, Math.min(offset + FRAME_SAMPLES, samples.length));
    frames.push(new AudioFrame(chunk, 16000, 1, chunk.length));
  }

  return frames;
}

async function main() {
  initializeLogger({ pretty: false, level: "silent" });

  const pcmPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PCM_PATH;
  const frames = loadPcmFrames(pcmPath);
  const sttProvider = new DashScopeFunAsrRealtimeSTT(resolveDashScopeSpeechConfig());
  const stream = sttProvider.stream();
  const transcripts: string[] = [];

  for (const frame of frames) {
    stream.pushFrame(frame);
  }
  stream.flush();
  stream.endInput();

  for await (const event of stream) {
    if (
      event.type === stt.SpeechEventType.INTERIM_TRANSCRIPT ||
      event.type === stt.SpeechEventType.FINAL_TRANSCRIPT
    ) {
      const text = event.alternatives[0]?.text?.trim();
      if (text) {
        transcripts.push(`${event.type}:${text}`);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        endpoint: resolveDashScopeSpeechConfig().funAsrEndpoint,
        pcmPath,
        frameCount: frames.length,
        transcripts,
      },
      null,
      2,
    ),
  );
}

await main();
