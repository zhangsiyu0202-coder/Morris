"use server";

/**
 * Server Actions for the manageMemories tool path
 * (per `.kiro/specs/morris-memory/` design.md §5).
 *
 * Every action: getCurrentUserId guard at entry; cross-owner check after
 * loadMemoryDoc — never trust a memoryId arg from the LLM unconditionally.
 *
 * createMemory + updateMemory fire embedAndSaveMemory in the background:
 * the tool response returns instantly; the embedding fills in moments later.
 * queryMemories tries cosine first; on EmbeddingError or any other throw,
 * falls back to fulltext via queryMemoriesByText with `fallback` flag set.
 */

import { createLogger } from "@merism/observability";

import { getCurrentUserId } from "@/lib/queries/auth";
import {
  createMemoryDoc,
  loadMemoryDoc,
  updateMemoryDoc,
  deleteMemoryDoc,
  listMemoriesForOwner,
  queryMemoriesByText,
  queryMemoriesByEmbedding,
} from "./server";
import {
  embedAndSaveMemory,
  embedQuery,
  cosineSearch,
  omitEmbedding,
  EmbeddingError,
} from "./embed";
import type { MorrisMemoryListItem } from "@merism/contracts";

const log = createLogger("action.memories");

const QUERY_DEFAULT_LIMIT = 5;
const QUERY_THRESHOLD = 0.3;
const LIST_DEFAULT_LIMIT = 20;

export async function createMemory(input: {
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<{ memoryId: string; snippet: string; truncated: boolean }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const memoryId = await createMemoryDoc({
    ownerUserId,
    content: input.content,
    metadata: input.metadata ?? {},
  });
  log.info("memory.created", { memoryId, ownerUserId });
  // Fire-and-forget embed task. Error logging happens inside embedAndSaveMemory.
  void embedAndSaveMemory(memoryId, input.content);
  const truncated = input.content.length > 80;
  return {
    memoryId,
    snippet: input.content.slice(0, 80),
    truncated,
  };
}

export type MemoryQueryFallback = null | "embedding-error" | "scale-fulltext-only";

export async function queryMemories(input: {
  queryText: string;
  metadataFilter?: Record<string, unknown>;
  limit?: number;
}): Promise<{
  matches: Array<{
    item: Omit<MorrisMemoryListItem, "embedding"> | MorrisMemoryListItem;
    score: number | null;
  }>;
  fallback: MemoryQueryFallback;
}> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const limit = input.limit ?? QUERY_DEFAULT_LIMIT;
  try {
    const queryVec = await embedQuery(input.queryText);
    const rows = await queryMemoriesByEmbedding(ownerUserId, input.metadataFilter);
    const cosine = cosineSearch(queryVec, rows, {
      limit,
      threshold: QUERY_THRESHOLD,
    });
    return {
      matches: cosine.map((m) => ({
        item: omitEmbedding(m.item),
        score: m.score,
      })),
      fallback: null,
    };
  } catch (err) {
    const isEmbedderDown = err instanceof EmbeddingError;
    log.warn("memory.query.embedding.failed", {
      err: String(err),
      isEmbedderDown,
    });
    const items = await queryMemoriesByText(ownerUserId, input.queryText, {
      metadataFilter: input.metadataFilter,
      limit,
    });
    return {
      matches: items.map((item) => ({ item, score: null })),
      fallback: isEmbedderDown ? "embedding-error" : "scale-fulltext-only",
    };
  }
}

export async function updateMemory(input: {
  memoryId: string;
  content?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const doc = await loadMemoryDoc(input.memoryId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");
  await updateMemoryDoc(input.memoryId, {
    content: input.content,
    metadata: input.metadata,
  });
  log.info("memory.updated", { memoryId: input.memoryId });
  if (input.content) {
    void embedAndSaveMemory(input.memoryId, input.content);
  }
  return { ok: true as const };
}

export async function deleteMemory(input: {
  memoryId: string;
}): Promise<{ ok: true }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const doc = await loadMemoryDoc(input.memoryId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");
  await deleteMemoryDoc(input.memoryId);
  log.info("memory.deleted", { memoryId: input.memoryId });
  return { ok: true as const };
}

export async function listMemories(input: {
  metadataFilter?: Record<string, unknown>;
  limit?: number;
} = {}): Promise<{ items: MorrisMemoryListItem[] }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const items = await listMemoriesForOwner(ownerUserId, {
    limit: input.limit ?? LIST_DEFAULT_LIMIT,
    metadataFilter: input.metadataFilter,
  });
  return { items };
}
