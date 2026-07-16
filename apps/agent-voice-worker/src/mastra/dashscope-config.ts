const DEFAULT_FUN_ASR_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const DEFAULT_QWEN_TTS_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const DEFAULT_QWEN_LLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
// Fun-ASR-Flash NON-realtime sync recognize (per Model Studio 非实时语音识别 doc:
// "fun-asr-flash-2026-06-15 支持同步调用，适用于 5 分钟以内的音频文件"). Used with
// LiveKit's StreamAdapter: silero VAD segments each utterance, and each segment is
// sent to this HTTP endpoint for a one-shot recognize (no Fun-ASR streaming VAD).
// Endpoint = DashScope multimodal-generation; response text at output.text.
// Source: https://www.alibabacloud.com/help/zh/model-studio/non-realtime-speech-recognition-user-guide
const DEFAULT_FUN_ASR_FLASH_MODEL = "fun-asr-flash-2026-06-15";
const DEFAULT_FUN_ASR_FLASH_HTTP_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const DEFAULT_FUN_ASR_MODEL = "fun-asr-realtime-2026-02-28";
// Qwen3-TTS-Instruct-Flash-Realtime (instruction-capable). Per Model Studio
// 实时语音合成 doc, both Beijing and Singapore offer qwen3-tts-instruct-flash-realtime
// (stable == 2026-01-22). Same realtime WebSocket session protocol + params
// (session.update {voice, response_format, sample_rate, mode}) as qwen3-tts-flash-realtime;
// the optional `instructions` field is only needed for voice-style control, so the
// TTS adapter is unchanged. Voice "Cherry" remains supported.
// Source: https://www.alibabacloud.com/help/zh/model-studio/realtime-tts-user-guide#支持的模型与地域
const DEFAULT_QWEN_TTS_MODEL = "qwen3-tts-instruct-flash-realtime";
const DEFAULT_QWEN_TTS_VOICE = "Cherry";
// Qwen-TTS instruction-control persona: controls voice DELIVERY (语速/情感/特点),
// not what the agent says (that is the LLM's Survey.instruction, ADR-0015).
// Only Qwen3-TTS-Instruct-* models honor it; Chinese/English only, <= 1600 tokens.
// Written per the doc's guidance (多维/客观/具体: 用途+情感+语速+特点). Empty
// disables instruction control. Override via QWEN_TTS_INSTRUCTIONS.
// Source: https://www.alibabacloud.com/help/zh/model-studio/realtime-tts-user-guide#指令控制
const DEFAULT_QWEN_TTS_INSTRUCTIONS =
  "专业的访谈主持人,语气温和、有耐心,语速中等偏慢,吐字清晰、沉稳可信,善于倾听,适合一对一深度用户访谈。";
const DEFAULT_QWEN_LLM_MODEL = "qwen-plus";
const DEFAULT_LANGUAGE = "zh";

export interface DashScopeSpeechConfig {
  apiKey: string;
  funAsrEndpoint: string;
  funAsrModel: string;
  qwenTtsEndpoint: string;
  qwenLlmBaseUrl: string;
  funAsrFlashModel: string;
  funAsrFlashHttpEndpoint: string;
  qwenTtsModel: string;
  qwenTtsVoice: string;
  qwenTtsInstructions: string;
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
    funAsrModel:
      process.env.QWEN_ASR_MODEL ??
      process.env.FUN_ASR_MODEL ??
      DEFAULT_FUN_ASR_MODEL,
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
    funAsrFlashModel: process.env.FUN_ASR_FLASH_MODEL ?? DEFAULT_FUN_ASR_FLASH_MODEL,
    funAsrFlashHttpEndpoint:
      process.env.FUN_ASR_FLASH_HTTP_ENDPOINT ?? DEFAULT_FUN_ASR_FLASH_HTTP_ENDPOINT,
    qwenTtsModel: process.env.QWEN_TTS_MODEL ?? DEFAULT_QWEN_TTS_MODEL,
    qwenTtsVoice: process.env.QWEN_TTS_VOICE ?? DEFAULT_QWEN_TTS_VOICE,
    qwenTtsInstructions: process.env.QWEN_TTS_INSTRUCTIONS ?? DEFAULT_QWEN_TTS_INSTRUCTIONS,
    qwenLlmModel: process.env.QWEN_LLM_MODEL ?? process.env.QWEN_VL_MODEL ?? DEFAULT_QWEN_LLM_MODEL,
    language: process.env.QWEN_LANGUAGE ?? process.env.INTERVIEW_LANGUAGE ?? DEFAULT_LANGUAGE,
  };
}
