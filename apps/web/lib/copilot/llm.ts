// MerismV2 routes all LLM calls through DeepSeek (AGENTS.md); Qwen is reserved
// for ASR/TTS. CopilotKit's BuiltInAgent uses the AI SDK, so we bind the
// official OpenAI-compatible provider to DeepSeek's endpoint.
import { createOpenAI } from "@ai-sdk/openai";

export function createCopilotModel(): {
  baseURL: string;
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  modelName: string;
} {
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const modelName = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  const provider = createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseURL,
  });

  return {
    baseURL,
    model: provider(modelName),
    modelName,
  };
}
