/**
 * Memory embedding helpers — adapter around `lib/server/embedder-qwen` for
 * the manageMemories tool path.
 *
 * Per design.md §5: create/update fire-and-forget `embedAndSaveMemory` so the
 * tool response returns fast; the embedding is filled in milliseconds later
 * and picked up on the next `query` call. If the embedder is unavailable,
 * `queryMemories` falls back to fulltext search via `queryMemoriesByText`.
 */

import { createLogger } from "@merism/observability";

import { embedText, EMBEDDING_MODEL_TAG, EmbeddingError } from "@/lib/server/embedder-qwen";
import { saveMemoryEmbedding } from "./server";
import type { MorrisMemoryListItem } from "@merism/contracts";

const log = createLogger("memories.embed");

/**
 * Fire-and-forget after createMemory/updateMemory:
 *   1) embed the new content
 *   2) save embedding + embeddingModel back to the row
 * Errors are logged at warn — the row stays usable on the fulltext-fallback
 * path.
 */
export async function embedAndSaveMemory(memoryId: string, content: string): Promise<void> {
  try {
    const vec = await embedText(content);
    await saveMemoryEmbedding(memoryId, vec, EMBEDDING_MODEL_TAG);
    log.info("memory.embed.saved", { memoryId, dim: vec.length });
  } catch (err) {
    log.warn("memory.embed.failed", { memoryId, err: String(err) });
    // Swallow — caller is the fire-and-forget path; surfacing would only
    // produce an unhandled rejection.
  }
}

/** Re-export for actions.ts to detect embedder-specific errors. */
export { EmbeddingError };

interface CosineSearchInput {
  embedding: string;
}
interface CosineSearchOpts {
  limit: number;
  threshold: number;
}
export interface CosineMatch<T> {
  item: T;
  score: number;
}

/**
 * In-memory cosine similarity over the rows queryMemoriesByEmbedding returned.
 * Skips rows whose embedding fails JSON parse or dimension check (defensive
 * — schema-level superRefine should prevent this, but Appwrite eventual
 * consistency on partial writes is real).
 */
export function cosineSearch<T extends CosineSearchInput>(
  queryVec: number[],
  rows: T[],
  opts: CosineSearchOpts,
): Array<CosineMatch<T>> {
  const matches: Array<CosineMatch<T>> = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    if (!Array.isArray(vec) || vec.length !== queryVec.length) continue;
    const score = cosine(queryVec, vec);
    if (score >= opts.threshold) {
      matches.push({ item: row, score });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, opts.limit);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
  return denom === 0 ? 0 : dot / denom;
}

/** Helper used by actions.queryMemories — wraps embedText with cleaner naming. */
export async function embedQuery(queryText: string): Promise<number[]> {
  return embedText(queryText);
}

/**
 * Strip embedding from a row before returning to the LLM (token cost +
 * 12KB-per-row noise). The actions layer passes through to the tool result.
 */
export function omitEmbedding<T extends { embedding?: string }>(
  row: T,
): Omit<T, "embedding"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { embedding: _e, ...rest } = row;
  return rest;
}

export type MemoryWithEmbedding = MorrisMemoryListItem & { embedding: string };
