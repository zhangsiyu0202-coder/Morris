import type { Databases } from "node-appwrite";
import { NotebookSchema } from "@merism/contracts";
import type { Notebook } from "@merism/contracts";
import { DATABASE_ID, getSessionDb, Query } from "./client";

const NOTEBOOKS = "notebooks";

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

/** List notebooks the caller may read (owner + workspace team), newest first.
 * Reads via the session client — Appwrite enforces tenant isolation natively. */
export async function listNotebooks(databases?: Databases): Promise<Notebook[]> {
  const dbx = databases ?? (await getSessionDb());
  const result = await dbx.listDocuments(DATABASE_ID, NOTEBOOKS, [
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

/** Read a single notebook by Appwrite `$id`. Returns null when absent or the
 * caller may not read it (session client is the gate). */
export async function getNotebookById(
  id: string,
  databases?: Databases,
): Promise<Notebook | null> {
  const dbx = databases ?? (await getSessionDb());
  const result = await dbx.listDocuments(DATABASE_ID, NOTEBOOKS, [
    Query.equal("$id", id),
    Query.limit(1),
  ]);
  const raw = result.documents[0];
  if (!raw) return null;
  const parsed = NotebookSchema.safeParse(decodeNotebook(raw));
  return parsed.success ? parsed.data : null;
}

/** Read a single notebook by `shortId`. Wave B+: URLs are `/notebooks/[shortId]`,
 * so this is the primary read path. Session client is the read gate. */
export async function getNotebookByShortId(
  shortId: string,
  databases?: Databases,
): Promise<Notebook | null> {
  if (!shortId) return null;
  const dbx = databases ?? (await getSessionDb());
  const result = await dbx.listDocuments(DATABASE_ID, NOTEBOOKS, [
    Query.equal("shortId", shortId),
    Query.limit(1),
  ]);
  const raw = result.documents[0];
  if (!raw) return null;
  const parsed = NotebookSchema.safeParse(decodeNotebook(raw));
  return parsed.success ? parsed.data : null;
}
