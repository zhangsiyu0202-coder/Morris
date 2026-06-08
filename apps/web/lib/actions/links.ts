"use server";

import { randomBytes } from "node:crypto";
import { ID } from "node-appwrite";
import { getServerClient, DATABASE_ID, Query } from "@/lib/queries/client";
import { requireOwnerUserId } from "@/lib/owner";
import type { InterviewLink } from "@merism/contracts";

const LINKS = "interview_links";
const SURVEYS = "surveys";

type Raw = Record<string, unknown>;

async function assertLinkOwned(surveyId: string): Promise<void> {
  const owner = await requireOwnerUserId();
  const db = getServerClient().databases;
  const doc = (await db.getDocument(DATABASE_ID, SURVEYS, surveyId)) as unknown as Raw;
  if (doc.ownerUserId !== owner) {
    throw new Error("survey_not_owned");
  }
}

function docToLink(d: Raw): InterviewLink {
  return {
    $id: String(d.$id),
    surveyId: String(d.surveyId),
    token: String(d.token),
    mode: (d.mode as InterviewLink["mode"]) ?? "single_use",
    maxUses: Number(d.maxUses ?? 1),
    usedCount: Number(d.usedCount ?? 0),
    expiresAt: String(d.expiresAt ?? new Date().toISOString()),
    isRevoked: Boolean(d.isRevoked ?? false),
    label: d.label ? String(d.label) : undefined,
  };
}

export async function createInterviewLink(
  surveyId: string,
  opts: {
    mode: "single_use" | "reusable";
    maxUses: number;
    expiresAt: string;
    label?: string;
  },
): Promise<InterviewLink> {
  await assertLinkOwned(surveyId);
  const token = randomBytes(24).toString("base64url");
  const db = getServerClient().databases;
  const doc = await db.createDocument(DATABASE_ID, LINKS, ID.unique(), {
    surveyId,
    token,
    mode: opts.mode,
    maxUses: opts.maxUses,
    usedCount: 0,
    expiresAt: opts.expiresAt,
    isRevoked: false,
    label: opts.label ?? null,
  });
  return docToLink(doc as unknown as Raw);
}

export async function revokeInterviewLink(linkId: string): Promise<void> {
  const db = getServerClient().databases;
  const doc = (await db.getDocument(DATABASE_ID, LINKS, linkId)) as unknown as Raw;
  await assertLinkOwned(String(doc.surveyId));
  await db.updateDocument(DATABASE_ID, LINKS, linkId, { isRevoked: true });
}

export async function listInterviewLinks(surveyId: string): Promise<InterviewLink[]> {
  await assertLinkOwned(surveyId);
  const db = getServerClient().databases;
  const res = await db.listDocuments(DATABASE_ID, LINKS, [
    Query.equal("surveyId", surveyId),
    Query.orderDesc("$createdAt"),
    Query.limit(500),
  ]);
  return res.documents.map((d) => docToLink(d as unknown as Raw));
}

const TEST_LINK_LABEL = "测试访谈";

/** Find or create a reusable test interview link for researcher self-testing. */
export async function getOrCreateTestInterviewLink(surveyId: string): Promise<InterviewLink> {
  await assertLinkOwned(surveyId);
  const db = getServerClient().databases;
  const existing = await db.listDocuments(DATABASE_ID, LINKS, [
    Query.equal("surveyId", surveyId),
    Query.equal("label", TEST_LINK_LABEL),
    Query.equal("isRevoked", false),
    Query.limit(1),
  ]);
  const doc = existing.documents[0];
  if (doc) return docToLink(doc as unknown as Raw);

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return createInterviewLink(surveyId, {
    mode: "reusable",
    maxUses: 100,
    expiresAt: expiresAt.toISOString(),
    label: TEST_LINK_LABEL,
  });
}
