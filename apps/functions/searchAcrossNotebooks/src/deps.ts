/**
 * Real Deps factory for the searchAcrossNotebooks Function.
 *
 * Pure-core / SDK-wrapper split per AGENTS.md backend rules: handler.ts
 * receives a typed Deps object and contains no SDK imports. main.ts builds
 * the real Deps via this factory.
 */

import { Client, Databases, Query } from "node-appwrite";
import { embedText, EMBEDDING_DIM } from "./embedder-qwen.js";

export interface NotebookEmbeddingRow {
  $id: string;
  shortId: string;
  studyId: string;
  studyTitle: string;
  headline: string;
  textContent: string;
  embedding: number[]; // pre-decoded from JSON-string field
}

export interface FulltextHit {
  $id: string;
  shortId: string;
  studyId: string;
  studyTitle: string;
  headline: string;
  textContent: string;
}

export interface SearchAcrossNotebooksDeps {
  embedQuery: (query: string) => Promise<number[]>;
  loadNotebooksWithEmbedding: (
    ownerUserId: string,
    studyIdFilter: string | null,
  ) => Promise<NotebookEmbeddingRow[]>;
  searchNotebooksFulltext: (
    query: string,
    ownerUserId: string,
    studyIdFilter: string | null,
    limit: number,
  ) => Promise<FulltextHit[]>;
}

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID ?? "merism";
const NOTEBOOKS = "notebooks";

export function createRealDeps(): SearchAcrossNotebooksDeps {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error("appwrite_not_configured");
  }
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const db = new Databases(client);

  return {
    embedQuery: embedText,
    loadNotebooksWithEmbedding: async (ownerUserId, studyIdFilter) => {
      const queries = [
        Query.equal("ownerUserId", ownerUserId),
        Query.select([
          "$id",
          "shortId",
          "studyId",
          "studyTitle",
          "headline",
          "textContent",
          "embedding",
          "embeddingModel",
        ]),
        Query.limit(200),
      ];
      if (studyIdFilter) queries.push(Query.equal("studyId", studyIdFilter));
      const result = await db.listDocuments(DATABASE_ID, NOTEBOOKS, queries);
      const rows: NotebookEmbeddingRow[] = [];
      for (const raw of result.documents) {
        const r = raw as unknown as {
          $id: string;
          shortId: string;
          studyId: string;
          studyTitle: string;
          headline: string;
          textContent: string;
          embedding: string;
          embeddingModel: string;
        };
        if (!r.embedding) continue; // skip rows without embedding (Wave A/B fallback)
        let vec: number[];
        try {
          const parsed = JSON.parse(r.embedding);
          if (!Array.isArray(parsed) || parsed.length !== EMBEDDING_DIM) continue;
          vec = parsed as number[];
        } catch {
          continue;
        }
        rows.push({
          $id: r.$id,
          shortId: r.shortId,
          studyId: r.studyId,
          studyTitle: r.studyTitle,
          headline: r.headline,
          textContent: r.textContent,
          embedding: vec,
        });
      }
      return rows;
    },
    searchNotebooksFulltext: async (query, ownerUserId, studyIdFilter, limit) => {
      const queries = [
        Query.equal("ownerUserId", ownerUserId),
        Query.search("textContent", query),
        Query.select(["$id", "shortId", "studyId", "studyTitle", "headline", "textContent"]),
        Query.limit(limit),
      ];
      if (studyIdFilter) queries.push(Query.equal("studyId", studyIdFilter));
      const result = await db.listDocuments(DATABASE_ID, NOTEBOOKS, queries);
      return result.documents.map((raw) => {
        const r = raw as unknown as {
          $id: string;
          shortId: string;
          studyId: string;
          studyTitle: string;
          headline: string;
          textContent: string;
        };
        return {
          $id: r.$id,
          shortId: r.shortId,
          studyId: r.studyId,
          studyTitle: r.studyTitle,
          headline: r.headline,
          textContent: r.textContent,
        };
      });
    },
  };
}
