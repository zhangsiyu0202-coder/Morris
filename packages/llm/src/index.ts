import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type LiteLlmConfig = {
  baseUrl: string;
  apiKey: string;
};

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Creates the only TypeScript text-generation provider that talks to the
 * internal LiteLLM Proxy. The proxy retains provider credentials; callers
 * receive only its scoped server-side credential and stable model aliases.
 */
export function createLiteLlmProvider(config: LiteLlmConfig) {
  return createOpenAICompatible({
    name: "litellm",
    apiKey: config.apiKey,
    baseURL: normalizedBaseUrl(config.baseUrl),
  });
}
