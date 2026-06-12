/**
 * Server-side helpers for the morris_memories Appwrite collection.
 *
 * Per `.kiro/specs/morris-memory/` design.md §5. All Appwrite SDK touches
 * live in this module; actions.ts wraps them with auth + ownership guards.
 *
 * Borrowed from apps/web/lib/conversations/server.ts pattern (same OWNER_SCOPED
 * + documentSecurity model). Difference: memory adds embedding + cosine search
 * paths (Notebook-style fallback fulltext), and metadata is a tagged JSON
 * object indexed by metadataKeys array.
 */

import { Client, Databases, ID, Permission, Query, Role } from "node-appwrite";
import type {
  MorrisMemory,
  MorrisMemoryListItem,
} from "@merism/contracts";

const COLLECTION_ID = "morris_memories";

function databaseId(): string {
  return process.env.APPWRITE_DATABASE_ID ?? "merism";
}

function getServerKeyClient(): Databases {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error(
      "Appwrite server credentials missing (APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY)",
    );
  }
  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);
  return new Databases(client);
}

function ownerPermissions(ownerUserId: string): string[] {
  return [
    Permission.read(Role.user(ownerUserId)),
    Permission.update(Role.user(ownerUserId)),
    Permission.delete(Role.user(ownerUserId)),
  ];
}

interface CreateMemoryInput {
  ownerUserId: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Insert a new memory row. embedding starts as "" — the caller (actions.ts)
 * fires off embedAndSaveMemory in the background to fill it in.
 */
export async function createMemoryDoc(input: CreateMemoryInput): Promise<string> {
  const db = getServerKeyClient();
  const now = new Date().toISOString();
  const metadataJson = JSON.stringify(input.metadata);
  const metadataKeys = Object.keys(input.metadata).sort();
  const doc = await db.createDocument(
    databaseId(),
    COLLECTION_ID,
    ID.unique(),
    {
      ownerUserId: input.ownerUserId,
      content: input.content,
      metadata: metadataJson,
      metadataKeys,
      embedding: "",
      embeddingModel: "",
      createdAt: now,
      updatedAt: now,
    },
    ownerPermissions(input.ownerUserId),
  );
  return doc.$id;
}

export async function loadMemoryDoc(memoryId: string): Promise<MorrisMemory | null> {
  const db = getServerKeyClient();
  try {
    const doc = await db.getDocument(databaseId(), COLLECTION_ID, memoryId);
    return doc as unknown as MorrisMemory;
  } catch (err) {
    // Appwrite throws 404-ish when missing; treat as null. Other errors propagate.
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 404) {
      return null;
    }
    throw err;
  }
}

interface UpdateMemoryInput {
  content?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Update content and/or metadata. Bumps updatedAt; clears embedding when
 * content changes (so the LLM doesn't query stale embeddings while the
 * background re-embed task catches up).
 */
export async function updateMemoryDoc(
  memoryId: string,
  input: UpdateMemoryInput,
): Promise<void> {
  const db = getServerKeyClient();
  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (input.content !== undefined) {
    patch.content = input.content;
    // Stale embedding would mislead cosine search; reset until re-embed task
    // runs. Query.where(embedding != "") filters keeps stale rows out of the
    // vector lane (queryMemoriesByEmbedding skips empty-embedding rows).
    patch.embedding = "";
    patch.embeddingModel = "";
  }
  if (input.metadata !== undefined) {
    patch.metadata = JSON.stringify(input.metadata);
    patch.metadataKeys = Object.keys(input.metadata).sort();
  }
  await db.updateDocument(databaseId(), COLLECTION_ID, memoryId, patch);
}

/** Hard delete (per design.md §10 — same as Notebook/Conversation). */
export async function deleteMemoryDoc(memoryId: string): Promise<void> {
  const db = getServerKeyClient();
  await db.deleteDocument(databaseId(), COLLECTION_ID, memoryId);
}

/**
 * List for owner — omits embedding (列查询 N+1 friendly per design.md §5).
 * Used by:
 *  - system-prompt prepend on each request (limit 20)
 *  - manageMemories action=list (LLM browsing)
 */
export async function listMemoriesForOwner(
  ownerUserId: string,
  opts: {
    limit: number;
    /** Optional metadata-key filter — Appwrite Query.contains on metadataKeys array. */
    metadataFilter?: Record<string, unknown>;
  },
): Promise<MorrisMemoryListItem[]> {
  const db = getServerKeyClient();
  const limit = Math.max(1, Math.min(opts.limit, 50));
  const queries: string[] = [
    Query.equal("ownerUserId", ownerUserId),
    Query.orderDesc("updatedAt"),
    Query.limit(limit),
    Query.select([
      "$id",
      "ownerUserId",
      "content",
      "metadata",
      "metadataKeys",
      "embeddingModel",
      "createdAt",
      "updatedAt",
    ]),
  ];
  // metadata filter: requires the row's metadataKeys to contain *all* requested keys.
  // Appwrite contains is array-contains; we add one query per requested key
  // (logical AND across queries). Value-equality is not enforced here — the
  // caller can post-filter if it needs strict value matching.
  if (opts.metadataFilter) {
    for (const k of Object.keys(opts.metadataFilter)) {
      queries.push(Query.contains("metadataKeys", k));
    }
  }
  const result = await db.listDocuments(databaseId(), COLLECTION_ID, queries);
  return result.documents.map((doc) => doc as unknown as MorrisMemoryListItem);
}

/**
 * Fulltext fallback when embedder is unavailable. Returns shape compatible
 * with cosine search (same MorrisMemoryListItem-ish, but no `score` — the
 * caller decorates with score=null on the fallback path).
 *
 * Uses the by_text_search fulltext index declared on `content`.
 */
export async function queryMemoriesByText(
  ownerUserId: string,
  queryText: string,
  opts: {
    metadataFilter?: Record<string, unknown>;
    limit: number;
  },
): Promise<MorrisMemoryListItem[]> {
  const db = getServerKeyClient();
  const queries: string[] = [
    Query.equal("ownerUserId", ownerUserId),
    Query.search("content", queryText),
    Query.limit(opts.limit),
    Query.select([
      "$id",
      "ownerUserId",
      "content",
      "metadata",
      "metadataKeys",
      "embeddingModel",
      "createdAt",
      "updatedAt",
    ]),
  ];
  if (opts.metadataFilter) {
    for (const k of Object.keys(opts.metadataFilter)) {
      queries.push(Query.contains("metadataKeys", k));
    }
  }
  const result = await db.listDocuments(databaseId(), COLLECTION_ID, queries);
  return result.documents.map((doc) => doc as unknown as MorrisMemoryListItem);
}

/**
 * Pull all memories for owner *with* embedding for in-memory cosine search.
 * Skips rows with empty embedding (still being indexed). Bounded by N=200/user
 * on the hot path; if a user crosses ~500 memories the full fetch would start
 * to bite — at that point we'd add a Qdrant/Pinecone external store (see
 * design.md §9.B).
 */
export async function queryMemoriesByEmbedding(
  ownerUserId: string,
  metadataFilter?: Record<string, unknown>,
): Promise<Array<MorrisMemoryListItem & { embedding: string }>> {
  const db = getServerKeyClient();
  const queries: string[] = [
    Query.equal("ownerUserId", ownerUserId),
    Query.notEqual("embedding", ""),
    Query.limit(500), // hard upper bound; design.md §10.8 calls out 200 soft cap
  ];
  if (metadataFilter) {
    for (const k of Object.keys(metadataFilter)) {
      queries.push(Query.contains("metadataKeys", k));
    }
  }
  const result = await db.listDocuments(databaseId(), COLLECTION_ID, queries);
  return result.documents.map(
    (doc) => doc as unknown as MorrisMemoryListItem & { embedding: string },
  );
}

/**
 * Persist a freshly-computed embedding back to the row. Called by
 * embedAndSaveMemory in the background after createMemory/updateMemory.
 */
export async function saveMemoryEmbedding(
  memoryId: string,
  embedding: number[],
  embeddingModel: string,
): Promise<void> {
  const db = getServerKeyClient();
  await db.updateDocument(databaseId(), COLLECTION_ID, memoryId, {
    embedding: JSON.stringify(embedding),
    embeddingModel,
    updatedAt: new Date().toISOString(),
  });
}
