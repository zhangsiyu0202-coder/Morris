/**
 * DEV-ONLY fallback for `issueLivekitToken` when the Appwrite Function isn't
 * deployed locally (the project's docker-compose intentionally omits the
 * appwrite-executor service for foundation-setup). Mirrors the smoke script's
 * pattern of calling the pure handler in-process. Deps are inlined here
 * instead of imported from apps/functions/issueLivekitToken/src/deps.ts —
 * Next.js's webpack does not resolve the function's NodeNext-style .js extension
 * imports, but the pure handler.ts has only @merism/contracts as an external
 * import so it loads cleanly.
 */
import { NextResponse } from "next/server";
import {
  Client as AppwriteClient,
  Databases,
  Permission,
  Query,
  Role,
} from "node-appwrite";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import {
  buildInterviewRoomMetadataFromDraft,
  SurveyDraftSchema,
} from "@merism/contracts";

import type {
  IssueDeps,
  LinkRecord,
  SessionInit,
} from "../../../../functions/issueLivekitToken/src/handler";
import { issueLivekitToken } from "../../../../functions/issueLivekitToken/src/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB = "merism";

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function makeDeps(): IssueDeps {
  const env = {
    APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT!,
    APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID!,
    APPWRITE_API_KEY: process.env.APPWRITE_API_KEY!,
    LIVEKIT_URL: process.env.LIVEKIT_URL!,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY!,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET!,
  };
  for (const [k, v] of Object.entries(env)) {
    if (!v) throw new Error(`missing env ${k}`);
  }
  const client = new AppwriteClient()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const db = new Databases(client);
  const httpUrl = env.LIVEKIT_URL.replace(/^ws/, "http");
  const rooms = new RoomServiceClient(
    httpUrl,
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
  );

  return {
    livekitUrl: env.LIVEKIT_URL,
    now: () => Date.now(),
    async findLink(token: string): Promise<LinkRecord | null> {
      const res = await db.listDocuments(DB, "interview_links", [
        Query.equal("token", token),
        Query.limit(1),
      ]);
      const doc = res.documents[0] as Record<string, unknown> | undefined;
      if (!doc) return null;
      const survey = (await db.getDocument(DB, "surveys", doc.surveyId as string)) as Record<string, unknown>;
      const project = (await db.getDocument(DB, "projects", survey.projectId as string)) as Record<string, unknown>;
      return {
        $id: doc.$id as string,
        surveyId: doc.surveyId as string,
        ownerUserId: project.ownerUserId as string,
        workspaceId: (doc.workspaceId ?? project.workspaceId) as string | undefined,
        mode: doc.mode as "single_use" | "reusable",
        kind: doc.kind === "test" ? "test" : "production",
        maxUses: doc.maxUses as number,
        usedCount: (doc.usedCount as number | undefined) ?? 0,
        expiresAt: doc.expiresAt as string,
        isRevoked: (doc.isRevoked as boolean | undefined) ?? false,
        surveyStatus: survey.status as string,
      };
    },
    async createSession(sessionId: string, data: SessionInit): Promise<boolean> {
      const permissions = [
        Permission.read(Role.user(data.ownerUserId)),
        ...(data.workspaceId ? [Permission.read(Role.team(data.workspaceId))] : []),
      ];
      try {
        await db.createDocument(
          DB,
          "interview_sessions",
          sessionId,
          {
            surveyId: data.surveyId,
            linkId: data.linkId,
            ...(data.workspaceId ? { workspaceId: data.workspaceId } : {}),
            state: "created",
            livekitRoom: data.livekitRoom,
            intervieweeAlias: data.intervieweeAlias,
          },
          permissions,
        );
        return true;
      } catch (err) {
        if ((err as { code?: number } | null)?.code === 409) return false;
        throw err;
      }
    },
    async deleteSession(sessionId) {
      await db.deleteDocument(DB, "interview_sessions", sessionId);
    },
    async setUsedCount(linkId, count) {
      await db.updateDocument(DB, "interview_links", linkId, { usedCount: count });
    },
    async getSurveyMeta(surveyId) {
      const s = (await db.getDocument(DB, "surveys", surveyId)) as Record<string, unknown>;
      return { surveyId, title: s.title as string };
    },
    async createRoom(room: string, metadata: string) {
      const base = parseJson<{ sessionId?: string; surveyId?: string }>(metadata, {});
      let finalMetadata = metadata;
      if (base.sessionId && base.surveyId) {
        const survey = (await db.getDocument(DB, "surveys", base.surveyId)) as Record<string, unknown>;
        const sectionsRes = await db.listDocuments(DB, "survey_sections", [
          Query.equal("surveyId", base.surveyId),
        ]);
        const questionsRes = await db.listDocuments(DB, "question_blocks", [
          Query.equal("surveyId", base.surveyId),
        ]);
        const flow = parseJson<{ researchGoal?: string; targetAudience?: string; introScript?: string }>(
          survey.flowConfig as string,
          {},
        );
        const draft = SurveyDraftSchema.parse({
          title: survey.title as string,
          researchGoal: flow.researchGoal ?? "",
          targetAudience: flow.targetAudience ?? "",
          introScript: flow.introScript ?? "",
          sections: sectionsRes.documents
            .slice()
            .sort((a, b) => (a.order as number) - (b.order as number))
            .map((sec: Record<string, unknown>) => ({
              title: sec.title as string,
              objective:
                (sec.description as string) || (sec.sectionInstruction as string) || "",
              questions: questionsRes.documents
                .filter((q: Record<string, unknown>) => q.sectionId === sec.$id)
                .sort(
                  (a: Record<string, unknown>, b: Record<string, unknown>) =>
                    (a.orderInSection as number) - (b.orderInSection as number),
                )
                .map((q: Record<string, unknown>) => {
                  const cfg = parseJson<{ options?: string[] }>(q.config as string, {});
                  const probe = parseJson<{ level?: string; instruction?: string }>(
                    q.probeConfig as string,
                    {},
                  );
                  return {
                    questionText: q.prompt as string,
                    questionType: q.type as string,
                    probeLevel: probe.level === "deep" ? "deep" : "standard",
                    probeInstruction: probe.instruction ?? "",
                    options: cfg.options ?? [],
                  };
                }),
            })),
        });
        finalMetadata = JSON.stringify(
          buildInterviewRoomMetadataFromDraft({
            surveyId: base.surveyId,
            sessionId: base.sessionId,
            draft,
          }),
        );
      }
      await rooms.createRoom({ name: room, metadata: finalMetadata });
    },
    async deleteRoom(room) {
      await rooms.deleteRoom(room);
    },
    async signToken(args) {
      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: args.identity,
        ttl: args.ttlSeconds,
        metadata: args.metadata,
      });
      at.addGrant({
        roomJoin: true,
        room: args.room,
        canPublish: true,
        canSubscribe: true,
      });
      return at.toJwt();
    },
  };
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  try {
    const result = await issueLivekitToken(body, makeDeps());
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[dev-issue-token] handler threw", detail);
    return NextResponse.json(
      { error: "internal_error", detail },
      { status: 500 },
    );
  }
}
