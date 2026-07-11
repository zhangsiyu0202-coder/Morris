/**
 * searchAcrossNotebooks pure-core handler.
 *
 * Per Wave E design §9.2 + spec R5:
 * 1. Validate input (SearchAcrossNotebooksRequestSchema).
 * 2. Try to embed the query via Qwen DashScope text-embedding-v3 (1024-dim).
 * 3. Load owner-scoped notebooks (with optional studyId filter); if the row
 *    count exceeds EMBEDDING_BRUTEFORCE_LIMIT, OR the embedQuery call fails,
 *    fall back to Appwrite fulltext search and return `fallback` flag.
 * 4. Otherwise compute cosineSimilarity for each row, sort descending,
 *    take top `limit`.
 *
 * 100% pure: no SDK imports, no env reads. Deps are injected.
 *
 * IO 性能 note (review S1 #4): brute-force scales by I/O+JSON.parse, not the
 * O(N) cosine. EMBEDDING_BRUTEFORCE_LIMIT=100 caps single-query latency at
 * roughly 200-500ms (transferring up to ~1.25MB of embedding JSON + 100x
 * JSON.parse). Beyond that we fall back to fulltext to avoid >1s latency.
 */

import {
  SearchAcrossNotebooksRequestSchema,
  type SearchAcrossNotebooksRequest,
  type SearchAcrossNotebooksResponse,
} from "@merism/contracts";
import { cosineSimilarity } from "./cosine.js";
import type { SearchAcrossNotebooksDeps } from "./deps.js";

export const EMBEDDING_BRUTEFORCE_LIMIT = 100;

type SearchResult =
  | { status: 200; body: SearchAcrossNotebooksResponse }
  | { status: 400; body: { error: string; traceId?: string } };

/**
 * Trim a textContent paragraph to a snippet around the first match (or
 * leading words if no match). Keeps roughly 200 chars.
 */
function makeSnippet(textContent: string, query: string, max = 200): string {
  if (!textContent) return "";
  const idx = query
    ? textContent.toLowerCase().indexOf(query.toLowerCase().slice(0, 20))
    : -1;
  if (idx === -1) return textContent.slice(0, max).trim();
  const start = Math.max(0, idx - 60);
  return textContent.slice(start, start + max).trim();
}

export async function searchAcrossNotebooks(
  rawInput: unknown,
  deps: SearchAcrossNotebooksDeps,
): Promise<SearchResult> {
  const parsed = SearchAcrossNotebooksRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: `invalid_input: ${parsed.error.issues.map((i) => i.message).join("; ")}` },
    };
  }
  const input: SearchAcrossNotebooksRequest = parsed.data;
  const { query, ownerUserId, studyId, limit } = input;
  const studyIdFilter = studyId ?? null;

  // First, count owner-scoped notebooks to decide brute-force vs fulltext.
  let rows = await deps.loadNotebooksWithEmbedding(ownerUserId, studyIdFilter);

  // If too many rows OR embedding generation fails → fulltext fallback.
  if (rows.length > EMBEDDING_BRUTEFORCE_LIMIT) {
    return {
      status: 200,
      body: await runFulltextFallback(deps, query, ownerUserId, studyIdFilter, limit, "scale-fulltext-only"),
    };
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await deps.embedQuery(query);
  } catch (err) {
    void err;
    return {
      status: 200,
      body: await runFulltextFallback(deps, query, ownerUserId, studyIdFilter, limit, "embedding-error"),
    };
  }

  // Brute-force cosine + top-N
  const scored = rows
    .map((row) => ({ row, score: cosineSimilarity(queryEmbedding, row.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    status: 200,
    body: {
      matches: scored.map(({ row, score }) => ({
        notebookShortId: row.shortId,
        studyId: row.studyId,
        studyTitle: row.studyTitle,
        headline: row.headline,
        snippet: makeSnippet(row.textContent, query),
        score,
      })),
    },
  };
}

async function runFulltextFallback(
  deps: SearchAcrossNotebooksDeps,
  query: string,
  ownerUserId: string,
  studyIdFilter: string | null,
  limit: number,
  fallbackKind: "scale-fulltext-only" | "embedding-error",
): Promise<SearchAcrossNotebooksResponse> {
  const hits = await deps.searchNotebooksFulltext(query, ownerUserId, studyIdFilter, limit);
  return {
    matches: hits.map((h) => ({
      notebookShortId: h.shortId,
      studyId: h.studyId,
      studyTitle: h.studyTitle,
      headline: h.headline,
      snippet: makeSnippet(h.textContent, query),
      score: 0, // fulltext lacks a normalized score; client surfaces the fallback flag instead
    })),
    fallback: fallbackKind,
  };
}
