import { resolveDashScopeSpeechConfig } from "./dashscope-config";
import { DashScopeFunAsrFlashSTT } from "./dashscope-funasr-flash-stt";
import { DashScopeQwenRealtimeTTS } from "./dashscope-qwen-tts";

export function buildVoiceWorkerSpeechProviders() {
  const config = resolveDashScopeSpeechConfig();

  return {
    // Do not pass `vad`: @mastra/livekit prewarms one Silero VAD per worker
    // process and reuses it for every session. StreamAdapter feeds each
    // Silero-bounded utterance to this non-streaming FunASR implementation;
    // voice-worker.ts then gives the final end-of-turn decision to v1-mini.
    stt: new DashScopeFunAsrFlashSTT(config),
    tts: new DashScopeQwenRealtimeTTS(config),
  };
}
