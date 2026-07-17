import { z } from "zod";

import {
  PermanentProviderError,
  TransientProviderError,
  withRetry,
} from "@merism/observability";

export const JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
export const JINA_EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_BASE_URL = "https://api.inferera.com";

const AiHubMixEmbeddingResponseSchema = z.object({
  data: z.array(z.object({
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number()),
  })).min(1),
});

export type JinaEmbeddingTask = "retrieval.query" | "retrieval.passage";
export type EmbedEvidence = (input: { text: string; task: JinaEmbeddingTask }) => Promise<number[]>;

export function createAiHubMixJinaEmbedder(options: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}): EmbedEvidence {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/embeddings`;
  const model = options.model ?? JINA_EMBEDDING_MODEL;
  const fetchFn = options.fetchFn ?? fetch;

  return async ({ text, task }) => {
    if (!text.trim()) throw new PermanentProviderError("embedding text must not be empty");
    return withRetry(async () => {
      let response: Response;
      try {
        response = await fetchFn(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            input: [text],
            task,
            dimensions: JINA_EMBEDDING_DIMENSIONS,
            encoding_format: "float",
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new TransientProviderError("embedding request failed: network");
      }
      if (!response.ok) {
        const message = `embedding request failed: ${response.status}`;
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          throw new TransientProviderError(message);
        }
        throw new PermanentProviderError(message);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new PermanentProviderError("embedding response malformed");
      }
      const parsed = AiHubMixEmbeddingResponseSchema.safeParse(json);
      const vector = parsed.success ? parsed.data.data.find((item) => item.index === 0)?.embedding : undefined;
      if (!vector || vector.length !== JINA_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
        throw new PermanentProviderError("embedding response malformed");
      }
      return vector;
    }, { maxAttempts: 3, baseDelayMs: 100 });
  };
}
