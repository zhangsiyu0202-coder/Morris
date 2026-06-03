// Pure issueLivekitToken core. No SDK imports so it is unit/property testable
// with in-memory deps. Atomicity comes from deterministic per-slot session $ids:
// concurrent claims to the same slot collide (createSession -> false), so a
// single_use link yields exactly one session even under concurrency (P-DATA-05).
import {
  IssueLivekitTokenRequestSchema,
  type IssueLivekitTokenResponse,
} from "@merism/contracts";

export const TOKEN_TTL_SECONDS = 30 * 60; // Req 3.6: <= 30 min

export interface LinkRecord {
  $id: string;
  surveyId: string;
  ownerUserId: string;
  mode: "single_use" | "reusable";
  maxUses: number;
  usedCount: number;
  expiresAt: string;
}

export interface SessionInit {
  surveyId: string;
  linkId: string;
  ownerUserId: string;
  livekitRoom: string;
  intervieweeAlias?: string;
}

export interface IssueDeps {
  livekitUrl: string;
  now(): number;
  findLink(token: string): Promise<LinkRecord | null>;
  /** Create session with the given $id; return false on id collision (409). */
  createSession(sessionId: string, data: SessionInit): Promise<boolean>;
  deleteSession(sessionId: string): Promise<void>;
  setUsedCount(linkId: string, count: number): Promise<void>;
  getSurveyMeta(surveyId: string): Promise<{ surveyId: string; title: string }>;
  createRoom(room: string, metadata: string): Promise<void>;
  deleteRoom(room: string): Promise<void>;
  signToken(args: {
    room: string;
    identity: string;
    metadata: string;
    ttlSeconds: number;
  }): Promise<string>;
}

export type IssueResult =
  | { status: 200; body: IssueLivekitTokenResponse }
  | { status: 400 | 404 | 410 | 500; body: { error: string } };

export async function issueLivekitToken(
  rawInput: unknown,
  deps: IssueDeps,
): Promise<IssueResult> {
  const parsed = IssueLivekitTokenRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  const { linkToken, alias } = parsed.data;

  const link = await deps.findLink(linkToken);
  if (!link) return { status: 404, body: { error: "link_not_found" } };

  if (deps.now() > Date.parse(link.expiresAt))
    return { status: 410, body: { error: "link_expired" } };

  const effectiveMax = link.mode === "single_use" ? 1 : link.maxUses;
  if (link.usedCount >= effectiveMax)
    return { status: 410, body: { error: "link_exhausted" } };

  // Claim a slot via unique session $id. Skip slots already taken by concurrent
  // requests; if every slot up to the ceiling is taken, the link is exhausted.
  let sessionId = "";
  for (let k = link.usedCount; k < effectiveMax; k++) {
    const candidate = `s_${link.$id}_${k}`;
    const claimed = await deps.createSession(candidate, {
      surveyId: link.surveyId,
      linkId: link.$id,
      ownerUserId: link.ownerUserId,
      livekitRoom: candidate,
      intervieweeAlias: alias,
    });
    if (claimed) {
      sessionId = candidate;
      await deps.setUsedCount(link.$id, k + 1);
      break;
    }
  }
  if (!sessionId) return { status: 410, body: { error: "link_exhausted" } };

  try {
    await deps.createRoom(
      sessionId,
      JSON.stringify({
        sessionId,
        surveyId: link.surveyId,
      }),
    );
    const token = await deps.signToken({
      room: sessionId,
      identity: `interviewee:${sessionId}`,
      metadata: JSON.stringify({ sessionId, surveyId: link.surveyId, role: "interviewee" }),
      ttlSeconds: TOKEN_TTL_SECONDS,
    });
    const surveyMeta = await deps.getSurveyMeta(link.surveyId);
    return {
      status: 200,
      body: { sessionId, livekitUrl: deps.livekitUrl, token, surveyMeta },
    };
  } catch {
    // Rollback: drop the session (do not persist) and remove the room.
    await deps.deleteRoom(sessionId).catch(() => {});
    await deps.deleteSession(sessionId).catch(() => {});
    return { status: 500, body: { error: "internal_error" } };
  }
}
