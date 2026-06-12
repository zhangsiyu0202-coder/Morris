import type { Databases } from "node-appwrite";
import { NotebookSchema } from "@merism/contracts";
import type { Notebook } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query, tenantFilter, type TenantScope } from "./client";

const NOTEBOOKS = "notebooks";

function db(): Databases {
  return getServerClient().databases;
}

/**
 * Decode raw Appwrite document into a Notebook-shaped value:
 * - `report` is stored as a JSON string; deserialize to an object (or null on
 *   parse failure / empty fallback).
 *
 * Wave B+: new fields (shortId / content / textContent / visibility / embedding /
 * embeddingModel) are plain strings/enums and need no decoding; defaults applied
 * by the schema's `.default("")` cover legacy rows that pre-date Wave B.
 */
function decodeNotebook(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (typeof r.report === "string") {
    if (r.report === "") {
      r.report = null;
    } else {
      try {
        r.report = JSON.parse(r.report);
      } catch {
        // Wave A 写入侧 stringifies a valid NotebookReport; corrupt → null.
        r.report = null;
      }
    }
  }
  return r;
}

/** List all notebooks in the caller's tenant (workspace, else solo owner), newest first. */
export async function listNotebooks(
  scope: TenantScope,
  databases: Databases = db(),
): Promise<Notebook[]> {
  const result = await databases.listDocuments(DATABASE_ID, NOTEBOOKS, [
    tenantFilter(scope),
    Query.orderDesc("createdAt"),
    Query.limit(200),
  ]);
  const out: Notebook[] = [];
  for (const raw of result.documents) {
    const parsed = NotebookSchema.safeParse(decodeNotebook(raw));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Read a single notebook by Appwrite `$id`, scoped to the caller's tenant. */
export async function getNotebookById(
  scope: TenantScope,
  id: string,
  databases: Databases = db(),
): Promise<Notebook | null> {
  const result = await databases.listDocuments(DATABASE_ID, NOTEBOOKS, [
    Query.equal("$id", id),
    tenantFilter(scope),
    Query.limit(1),
  ]);
  const raw = result.documents[0];
  if (!raw) return null;
  const parsed = NotebookSchema.safeParse(decodeNotebook(raw));
  return parsed.success ? parsed.data : null;
}

/** Read a single notebook by `shortId`, scoped to the caller's tenant. Wave B+:
 * URLs are `/notebooks/[shortId]`, so this is the primary read path.
 */
export async function getNotebookByShortId(
  scope: TenantScope,
  shortId: string,
  databases: Databases = db(),
): Promise<Notebook | null> {
  if (!shortId) return null;
  const result = await databases.listDocuments(DATABASE_ID, NOTEBOOKS, [
    tenantFilter(scope),
    Query.equal("shortId", shortId),
    Query.limit(1),
  ]);
  const raw = result.documents[0];
  if (!raw) return null;
  const parsed = NotebookSchema.safeParse(decodeNotebook(raw));
  return parsed.success ? parsed.data : null;
}
