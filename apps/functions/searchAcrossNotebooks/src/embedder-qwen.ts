/**
 * Qwen DashScope `text-embedding-v3` adapter (1024-dim).
 *
 * Calls the OpenAI-compatible endpoint exposed by DashScope:
 * https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings
 *
 * Reuses the same DASHSCOPE_API_KEY as the realtime Qwen ASR/TTS adapters
 * in apps/agent (one provider, one credential pool). Per ADR-0002, all LLM
 * calls go to DeepSeek; embeddings are an exception explicitly carved out
 * for Qwen because DeepSeek does not yet expose an embedding endpoint.
 *
 * Per Wave E B4 修订决策: this same module is duplicated as
 * `apps/web/lib/server/embedder-qwen.ts` for the Next.js server runtime.
 * The two copies stay in sync by hand. When a third Function needs the
 * embedder we lift to a shared `packages/llm-providers/`. (YAGNI v1.)
 */

const QWEN_EMBED_ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const QWEN_EMBED_MODEL = "text-embedding-v3";
export const EMBEDDING_MODEL_TAG = "qwen.text-embedding-v3";
export const EMBEDDING_DIM = 1024;

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "missing_api_key"
      | "http_error"
      | "shape_mismatch"
      | "network_error",
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Call Qwen text-embedding-v3 and return a 1024-dim vector.
 * Throws `EmbeddingError` on any failure; never returns null.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError("DASHSCOPE_API_KEY not set", "missing_api_key");
  }
  if (!text || typeof text !== "string") {
    throw new EmbeddingError("embedText: input must be a non-empty string", "shape_mismatch");
  }

  let resp: Response;
  try {
    resp = await fetch(QWEN_EMBED_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: QWEN_EMBED_MODEL,
        input: text,
        dimensions: EMBEDDING_DIM,
        encoding_format: "float",
      }),
    });
  } catch (err) {
    throw new EmbeddingError(
      `network error: ${err instanceof Error ? err.message : String(err)}`,
      "network_error",
    );
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new EmbeddingError(
      `Qwen embedding HTTP ${resp.status}: ${detail.slice(0, 200)}`,
      "http_error",
    );
  }

  const json = (await resp.json()) as {
    data?: Array<{ embedding?: unknown }>;
  };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
    throw new EmbeddingError(
      `expected number[${EMBEDDING_DIM}], got ${Array.isArray(vec) ? `length ${vec.length}` : typeof vec}`,
      "shape_mismatch",
    );
  }
  return vec as number[];
}
