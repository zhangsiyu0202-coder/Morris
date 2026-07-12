import { resolveDashScopeSpeechConfig } from "./dashscope-config";
import { DashScopeFunAsrRealtimeSTT } from "./dashscope-funasr-stt";
import { DashScopeQwenRealtimeTTS } from "./dashscope-qwen-tts";

export function buildVoiceWorkerSpeechProviders() {
  const config = resolveDashScopeSpeechConfig();

  return {
    stt: new DashScopeFunAsrRealtimeSTT(config),
    tts: new DashScopeQwenRealtimeTTS(config),
  };
}
