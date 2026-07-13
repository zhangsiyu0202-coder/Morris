const DEFAULT_FUN_ASR_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const DEFAULT_QWEN_TTS_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const DEFAULT_QWEN_LLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_FUN_ASR_MODEL = "fun-asr-realtime-2026-02-28";
const DEFAULT_QWEN_TTS_MODEL = "qwen3-tts-flash-realtime";
const DEFAULT_QWEN_TTS_VOICE = "Cherry";
const DEFAULT_QWEN_LLM_MODEL = "qwen-plus";
const DEFAULT_LANGUAGE = "zh";

export interface DashScopeSpeechConfig {
  apiKey: string;
  funAsrEndpoint: string;
  qwenTtsEndpoint: string;
  qwenLlmBaseUrl: string;
  funAsrModel: string;
  qwenTtsModel: string;
  qwenTtsVoice: string;
  qwenLlmModel: string;
  language: string;
}

function requiredDashScopeApiKey() {
  const apiKey =
    process.env.DASHSCOPE_API_KEY ??
    process.env.QWEN_API_KEY ??
    process.env.STT_PROVIDER_KEY ??
    process.env.TTS_PROVIDER_KEY;

  if (!apiKey) {
    throw new Error(
      "Merism agent-voice-worker requires DASHSCOPE_API_KEY, QWEN_API_KEY, STT_PROVIDER_KEY, or TTS_PROVIDER_KEY.",
    );
  }

  return apiKey;
}

export function resolveDashScopeSpeechConfig(): DashScopeSpeechConfig {
  return {
    apiKey: requiredDashScopeApiKey(),
    funAsrEndpoint:
      process.env.DASHSCOPE_FUN_ASR_ENDPOINT ??
      process.env.DASHSCOPE_ASR_ENDPOINT ??
      DEFAULT_FUN_ASR_ENDPOINT,
    qwenTtsEndpoint:
      process.env.DASHSCOPE_QWEN_TTS_ENDPOINT ??
      process.env.DASHSCOPE_TTS_ENDPOINT ??
      process.env.DASHSCOPE_REALTIME_ENDPOINT ??
      DEFAULT_QWEN_TTS_ENDPOINT,
    qwenLlmBaseUrl:
      process.env.QWEN_COMPAT_BASE_URL ??
      process.env.DASHSCOPE_COMPAT_BASE_URL ??
      process.env.QWEN_BASE_URL ??
      DEFAULT_QWEN_LLM_BASE_URL,
    funAsrModel: process.env.QWEN_ASR_MODEL ?? process.env.FUN_ASR_MODEL ?? DEFAULT_FUN_ASR_MODEL,
    qwenTtsModel: process.env.QWEN_TTS_MODEL ?? DEFAULT_QWEN_TTS_MODEL,
    qwenTtsVoice: process.env.QWEN_TTS_VOICE ?? DEFAULT_QWEN_TTS_VOICE,
    qwenLlmModel: process.env.QWEN_LLM_MODEL ?? process.env.QWEN_VL_MODEL ?? DEFAULT_QWEN_LLM_MODEL,
    language: process.env.QWEN_LANGUAGE ?? process.env.INTERVIEW_LANGUAGE ?? DEFAULT_LANGUAGE,
  };
}
