import { createOpenAI } from "@ai-sdk/openai";

import { resolveDashScopeSpeechConfig } from "./dashscope-config";

const config = resolveDashScopeSpeechConfig();

const qwen = createOpenAI({
  apiKey: config.apiKey,
  baseURL: config.qwenLlmBaseUrl,
});

export const voiceWorkerModel = qwen(config.qwenLlmModel);
