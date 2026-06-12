"use server";

import { randomBytes } from "node:crypto";
import { ID } from "node-appwrite";
import { getServerClient, DATABASE_ID, Query } from "@/lib/queries/client";
import { requireOwnerUserId } from "@/lib/auth/owner";
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
    kind: d.kind === "test" ? "test" : "production",
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
    kind: "production",
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

/**
 * Find or create a reusable test interview link for researcher self-testing.
 *
 * Lookup order:
 * 1. By `kind === "test"` — the post-migration canonical path.
 * 2. By legacy `label === "测试访谈"` with no `kind === "test"` set —
 *    backfills the new `kind` field on the existing doc so we keep the same
 *    token (researcher won't see their pre-existing test URL silently rotate)
 *    and don't accumulate duplicate test rows. Old docs predate the contract
 *    change in `packages/contracts/src/entities.ts` and must be patched in
 *    place; without this researchers on local installs would get a fresh test
 *    link plus a stale "production"-kind one that fails the publish gate.
 * 3. Create a new `kind === "test"` doc.
 */
export async function getOrCreateTestInterviewLink(surveyId: string): Promise<InterviewLink> {
  await assertLinkOwned(surveyId);
  const db = getServerClient().databases;

  // (1) Canonical path.
  const byKind = await db.listDocuments(DATABASE_ID, LINKS, [
    Query.equal("surveyId", surveyId),
    Query.equal("kind", "test"),
    Query.equal("isRevoked", false),
    Query.limit(1),
  ]);
  const existing = byKind.documents[0];
  if (existing) return docToLink(existing as unknown as Raw);

  // (2) Legacy backfill. Only matches docs that did not yet receive the new
  // `kind` value — Appwrite returns `null` for unset enum fields and
  // `Query.equal("kind", "test")` already excluded any post-migration doc.
  const byLabel = await db.listDocuments(DATABASE_ID, LINKS, [
    Query.equal("surveyId", surveyId),
    Query.equal("label", TEST_LINK_LABEL),
    Query.equal("isRevoked", false),
    Query.limit(1),
  ]);
  const legacy = byLabel.documents[0];
  if (legacy) {
    const patched = await db.updateDocument(DATABASE_ID, LINKS, String(legacy.$id), {
      kind: "test",
    });
    return docToLink(patched as unknown as Raw);
  }

  // (3) Fresh create.
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const token = randomBytes(24).toString("base64url");
  const created = await db.createDocument(DATABASE_ID, LINKS, ID.unique(), {
    surveyId,
    token,
    mode: "reusable",
    kind: "test",
    maxUses: 100,
    usedCount: 0,
    expiresAt: expiresAt.toISOString(),
    isRevoked: false,
    label: TEST_LINK_LABEL,
  });
  return docToLink(created as unknown as Raw);
}
