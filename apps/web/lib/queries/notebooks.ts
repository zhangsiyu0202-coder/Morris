import type { Databases } from "node-appwrite";
import { InsightSchema } from "@merism/contracts";
import type { Insight } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "./client";

const INSIGHTS = "insights";

function db(): Databases {
  return getServerClient().databases;
}

function decodeInsight(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (typeof r.report === "string") {
    try {
      r.report = JSON.parse(r.report);
    } catch {
      // The Insight write path always stringifies a valid InsightReport, so
      // a parse failure here means corrupt data. Drop to null and the safeParse
      // below will reject the row.
      r.report = null;
    }
  }
  return r;
}

/** List all insights owned by `ownerUserId`, newest first. */
export async function listInsights(
  ownerUserId: string,
  databases: Databases = db(),
): Promise<Insight[]> {
  const result = await databases.listDocuments(DATABASE_ID, INSIGHTS, [
    Query.equal("ownerUserId", ownerUserId),
    Query.orderDesc("createdAt"),
    Query.limit(200),
  ]);
  const out: Insight[] = [];
  for (const raw of result.documents) {
    const parsed = InsightSchema.safeParse(decodeInsight(raw));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Read a single insight by id, scoped to its owner. */
export async function getInsightById(
  ownerUserId: string,
  id: string,
  databases: Databases = db(),
): Promise<Insight | null> {
  const result = await databases.listDocuments(DATABASE_ID, INSIGHTS, [
    Query.equal("$id", id),
    Query.equal("ownerUserId", ownerUserId),
    Query.limit(1),
  ]);
  const raw = result.documents[0];
  if (!raw) return null;
  const parsed = InsightSchema.safeParse(decodeInsight(raw));
  return parsed.success ? parsed.data : null;
}
