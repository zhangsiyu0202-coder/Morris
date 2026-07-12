// Real deps wiring Appwrite Server SDK + LiveKit. The LiveKit apiSecret is read
// only here from env and never returned or logged (Req 3.7).
import { Client, Databases, Permission, Query, Role } from "node-appwrite";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import { buildInterviewRoomMetadataFromDraft } from "@merism/contracts";
import type { IssueDeps, LinkRecord, SessionInit } from "./handler.js";
import { buildSurveyDraftFromDocs } from "./survey-draft-mapper.js";

const DB = "merism";

interface Env {
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_ID: string;
  APPWRITE_API_KEY: string;
  LIVEKIT_URL: string;
  LIVEKIT_INTERNAL_URL?: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  /**
   * Registered agent name of the Mastra voice worker. Post ADR-0013 the worker
   * is dispatched unconditionally on every token issuance — the historical
   * "only if this env is set" gating existed because two workers (Python auto
   * + TS explicit) could otherwise join the same room. Now there is only one
   * worker; the env stays overridable for rollout drills / local canaries.
   */
  MERISM_TS_VOICE_AGENT_NAME: string;
}

function req(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function requireEnv(): Env {
  return {
    APPWRITE_ENDPOINT: req("APPWRITE_ENDPOINT"),
    APPWRITE_PROJECT_ID: req("APPWRITE_PROJECT_ID"),
    APPWRITE_API_KEY: req("APPWRITE_API_KEY"),
    LIVEKIT_URL: req("LIVEKIT_URL"),
    LIVEKIT_INTERNAL_URL: process.env.LIVEKIT_INTERNAL_URL,
    LIVEKIT_API_KEY: req("LIVEKIT_API_KEY"),
    LIVEKIT_API_SECRET: req("LIVEKIT_API_SECRET"),
    // Registered name of apps/agent-voice-worker (see src/mastra/voice-worker.ts).
    // Overridable only for rollout drills; the default is the production name.
    MERISM_TS_VOICE_AGENT_NAME:
      process.env.MERISM_TS_VOICE_AGENT_NAME ?? "merism-mastra-voice-worker",
  };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createRealDeps(): IssueDeps {
  const env = requireEnv();
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const db = new Databases(client);
  // RoomServiceClient runs server-to-server (this Function -> LiveKit).
  // From the OpenRuntimes runtime container, "ws://localhost:7880" doesn't
  // resolve to LiveKit (it points at the runtime itself). Use
  // LIVEKIT_INTERNAL_URL when set; that env var carries the in-network
  // address (e.g. "ws://livekit:7880"), while LIVEKIT_URL stays as the
  // browser-facing public address. Falls back to LIVEKIT_URL if no
  // separate internal URL is configured.
  const serverSideUrl = (env.LIVEKIT_INTERNAL_URL ?? env.LIVEKIT_URL).replace(/^ws/, "http");
  const rooms = new RoomServiceClient(serverSideUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const dispatch = new AgentDispatchClient(serverSideUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

  return {
    livekitUrl: env.LIVEKIT_URL,
    now: () => Date.now(),

    async findLink(token: string): Promise<LinkRecord | null> {
      const res = await db.listDocuments(DB, "interview_links", [
        Query.equal("token", token),
        Query.limit(1),
      ]);
      const doc = res.documents[0] as any;
      if (!doc) return null;
      const survey = (await db.getDocument(DB, "surveys", doc.surveyId)) as any;
      const project = (await db.getDocument(DB, "projects", survey.projectId)) as any;
      return {
        $id: doc.$id,
        surveyId: doc.surveyId,
        ownerUserId: project.ownerUserId,
        workspaceId: doc.workspaceId ?? project.workspaceId ?? undefined,
        mode: doc.mode,
        kind: doc.kind === "test" ? "test" : "production",
        maxUses: doc.maxUses,
        usedCount: doc.usedCount ?? 0,
        expiresAt: doc.expiresAt,
        isRevoked: doc.isRevoked ?? false,
        surveyStatus: survey.status,
      };
    },

    async checkQuota(workspaceId: string): Promise<"ok" | "over"> {
      try {
        const q = (await db.getDocument(DB, "workspace_quota", `wq_${workspaceId}`)) as any;
        return q.state === "over" ? "over" : "ok";
      } catch {
        return "ok"; // no quota row yet => not gated
      }
    },

    async createSession(sessionId: string, data: SessionInit): Promise<boolean> {
      try {
        // Owner always reads; when the session belongs to a workspace, its team
        // can read too (ADR-0006 read=team). Additive — the existing study-level
        // (API-key) read path is unaffected; this forward-enables native
        // session-client reads by workspace members.
        const permissions = [
          Permission.read(Role.user(data.ownerUserId)),
          ...(data.workspaceId ? [Permission.read(Role.team(data.workspaceId))] : []),
        ];
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
      } catch (e: any) {
        if (e?.code === 409) return false; // slot already claimed
        throw e;
      }
    },

    async deleteSession(sessionId: string): Promise<void> {
      await db.deleteDocument(DB, "interview_sessions", sessionId);
    },

    async listOrphanSessions(linkId: string, olderThanMs: number): Promise<string[]> {
      // An orphan: state="created" AND $createdAt older than (now - grace).
      // Appwrite stores $createdAt as ISO 8601, so compare via lessThan with
      // the ISO cutoff. We don't paginate — single_use links have at most 1
      // session per link, reusable links bound at maxUses (small). If a
      // pathological link accumulates more than 25 orphans we cap there and
      // sweep the rest on the next click; correctness is maintained
      // (idempotent reclaim).
      const cutoffIso = new Date(Date.now() - olderThanMs).toISOString();
      // nosemgrep: no-silent-catch-fallback (orphan reclaim is best-effort and idempotent; failure defers cleanup to next click)
      try {
        const res = await db.listDocuments(DB, "interview_sessions", [
          Query.equal("linkId", linkId),
          Query.equal("state", "created"),
          Query.lessThan("$createdAt", cutoffIso),
          Query.limit(25),
        ]);
        return res.documents.map((d: any) => d.$id);
      } catch {
        // listDocuments failure is recoverable — skip reclaim this round and
        // let normal slot allocation proceed. The orphans remain in the
        // table; the next click can sweep them.
        return [];
      }
    },

    async setUsedCount(linkId: string, count: number): Promise<void> {
      await db.updateDocument(DB, "interview_links", linkId, { usedCount: count });
    },

    async getSurveyMeta(surveyId: string): Promise<{ surveyId: string; title: string }> {
      const s = (await db.getDocument(DB, "surveys", surveyId)) as any;
      return { surveyId, title: s.title };
    },

    async createRoom(room: string, metadata: string): Promise<void> {
      const baseMetadata = parseJson<{ sessionId?: string; surveyId?: string }>(metadata, {});
      let finalMetadata = metadata;

      if (baseMetadata.sessionId && baseMetadata.surveyId) {
        const survey = (await db.getDocument(DB, "surveys", baseMetadata.surveyId)) as any;
        const sectionsRes = await db.listDocuments(DB, "survey_sections", [
          Query.equal("surveyId", baseMetadata.surveyId),
        ]);
        const questionsRes = await db.listDocuments(DB, "question_blocks", [
          Query.equal("surveyId", baseMetadata.surveyId),
        ]);
        const draft = buildSurveyDraftFromDocs({
          survey: {
            $id: survey.$id,
            title: survey.title,
            flowConfig: parseJson<{
              researchGoal?: string;
              targetAudience?: string;
              introScript?: string;
            }>(survey.flowConfig, {}),
          },
          sections: sectionsRes.documents.map((s: any) => ({
            $id: s.$id,
            title: s.title,
            description: s.description,
            sectionInstruction: s.sectionInstruction,
            order: s.order,
          })),
          questions: questionsRes.documents.map((q: any) => ({
            $id: q.$id,
            sectionId: q.sectionId,
            prompt: q.prompt,
            type: q.type,
            orderInSection: q.orderInSection,
            // `config` bucket carries options + editor-generated `stableId`
            // (for branchRule.jumpToQuestionId targets) + `allowSkip`. All
            // three are needed downstream — the mapper's superRefine will
            // reject a draft whose branchRules reference a missing
            // stableId, and skipping stableId silently would surface as
            // a generic 500 to interviewees. Widen the parse shape here.
            config: parseJson<{ options?: string[]; stableId?: string; allowSkip?: boolean }>(
              q.config,
              {},
            ),
            probeConfig: parseJson<{ level?: string; instruction?: string }>(q.probeConfig, {}),
            // Stimulus (image/video/url) is stored as its own top-level
            // JSON attribute on QuestionBlock, not inside `config`. Parse
            // when present so the flow-engine composer can attach it to
            // the resulting QuestionStep.
            stimulus: q.stimulus ? parseJson<unknown>(q.stimulus, null) : undefined,
            // `skipLogic` is the Appwrite bucket that hosts researcher-
            // authored branchRules (piggybacked there by the guide-editor
            // writer to avoid adding a new attribute). Historically this
            // was read as `{}` and thrown away; that silently made the
            // entire BranchRulesEditor UI a no-op. Read + propagate to
            // the mapper.
            skipLogic: parseJson<{ branchRules?: unknown }>(q.skipLogic, {}),
          })),
        });

        finalMetadata = JSON.stringify(
          buildInterviewRoomMetadataFromDraft({
            surveyId: baseMetadata.surveyId,
            sessionId: baseMetadata.sessionId,
            draft,
          }),
        );
      }

      // LiveKit room defaults per Server SDK v2 spec
      // (https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/README.md#managing-rooms):
      //   emptyTimeout — seconds after the last participant leaves before the
      //     room is GC'd. Server default ≈ 5 min, which can drop the room
      //     during a slow agent dispatch / interviewee reconnect window. One
      //     hour comfortably covers a 30–45 min interview plus margin.
      //   maxParticipants — defense in depth: the design has 1 interviewee +
      //     1 agent. Cap at 5 to leave headroom for the agent reconnect
      //     window and any future transient participant (e.g. egress agent),
      //     without ever admitting a third human.
      await rooms.createRoom({
        name: room,
        metadata: finalMetadata,
        emptyTimeout: 60 * 60,
        maxParticipants: 5,
      });

      // Post ADR-0013 the Mastra voice worker is the ONLY interview worker.
      // `issueLivekitToken` dispatches it explicitly on every token issuance
      // — no auto-dispatch, no fan-out, no double-worker race that the older
      // "Python worker auto-dispatches + TS worker sometimes explicit-dispatches"
      // topology could produce. Per LiveKit Server SDK docs, explicit dispatch
      // requires the worker to be registered with an `agentName` — which
      // `apps/agent-voice-worker/src/mastra/voice-worker.ts` does under the
      // same `MERISM_TS_VOICE_AGENT_NAME` value.
      await dispatch.createDispatch(room, env.MERISM_TS_VOICE_AGENT_NAME, {
        metadata: JSON.stringify({
          threadId: baseMetadata.sessionId ?? room,
          resourceId: baseMetadata.surveyId ?? room,
          requestContext: {
            sessionId: baseMetadata.sessionId ?? room,
            surveyId: baseMetadata.surveyId ?? null,
            source: "issueLivekitToken",
          },
        }),
      });
    },

    async deleteRoom(room: string): Promise<void> {
      await rooms.deleteRoom(room);
    },

    async signToken(args): Promise<string> {
      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: args.identity,
        ttl: args.ttlSeconds,
        metadata: args.metadata,
      });
      at.addGrant({ roomJoin: true, room: args.room, canPublish: true, canSubscribe: true });
      return at.toJwt();
    },
  };
}
