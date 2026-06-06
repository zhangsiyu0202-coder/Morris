import { vi } from "vitest";
import type { Databases } from "node-appwrite";

/**
 * Minimal in-memory `Databases` stand-in that supports `listDocuments`.
 * Other methods throw if hit, so a test that mistakenly calls them will fail
 * loudly instead of silently returning undefined.
 *
 * `node-appwrite@14` serializes each Query as a JSON string of the form
 * `{"method":"equal","attribute":"ownerUserId","values":["user-1"]}`. We
 * decode that here to filter the fake fixture in-process.
 */
export interface FakeDatabases {
  databases: Databases;
  /** All listDocuments calls captured for assertion. */
  calls: Array<{ databaseId: string; collectionId: string; queries: string[] }>;
}

interface CollectionFixture {
  documents: unknown[];
}

interface DecodedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

function decode(q: string): DecodedQuery | null {
  try {
    const parsed = JSON.parse(q);
    if (parsed && typeof parsed === "object" && typeof parsed.method === "string") {
      return parsed as DecodedQuery;
    }
    return null;
  } catch {
    return null;
  }
}

export function makeFakeDatabases(
  fixtures: Record<string, CollectionFixture>,
): FakeDatabases {
  const calls: FakeDatabases["calls"] = [];
  const listDocuments = vi.fn(
    async (databaseId: string, collectionId: string, queries: string[] = []) => {
      calls.push({ databaseId, collectionId, queries });
      const fixture = fixtures[collectionId];
      if (!fixture) return { documents: [], total: 0 };

      const equalFilters: Array<{ attribute: string; values: unknown[] }> = [];
      for (const q of queries) {
        const d = decode(q);
        if (d?.method === "equal" && d.attribute && Array.isArray(d.values)) {
          equalFilters.push({ attribute: d.attribute, values: d.values });
        }
      }

      const documents = fixture.documents.filter((doc) => {
        const r = doc as Record<string, unknown>;
        for (const f of equalFilters) {
          const docVal = r[f.attribute];
          if (docVal === undefined) continue; // attribute absent → skip filter
          if (!f.values.includes(docVal as never)) return false;
        }
        return true;
      });
      return { documents, total: documents.length };
    },
  );
  const databases = { listDocuments } as unknown as Databases;
  return { databases, calls };
}
