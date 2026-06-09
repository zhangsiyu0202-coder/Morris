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
  kind: "production" | "test";
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  isRevoked: boolean;
  surveyStatus: string;
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

  if (link.isRevoked)
    return { status: 410, body: { error: "link_revoked" } };

  // Publish gate. Production links require a `published` survey. Test links
  // (researcher self-test before recruitment) bypass the gate for the live
  // editing states (draft/published/paused) but still reject terminal states
  // (closed/archived) — there is nothing to test on a finished survey.
  if (link.kind === "test") {
    if (link.surveyStatus === "closed" || link.surveyStatus === "archived")
      return { status: 410, body: { error: "survey_not_published" } };
  } else if (link.surveyStatus !== "published") {
    return { status: 410, body: { error: "survey_not_published" } };
  }

  const effectiveMax = link.mode === "single_use" ? 1 : link.maxUses;
  if (link.usedCount >= effectiveMax)
    return { status: 410, body: { error: "link_exhausted" } };

  // Claim a slot via unique session $id. Skip slots already taken by concurrent
  // requests; if every slot up to the ceiling is taken, the link is exhausted.
  let sessionId = "";
  let claimedSlotIndex = -1;
  const previousUsedCount = link.usedCount;
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
      claimedSlotIndex = k;
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
      body: { sessionId, livekitUrl: deps.livekitUrl, token, surveyMeta, linkKind: link.kind },
    };
  } catch {
    // Rollback in reverse order of side effects, all best-effort:
    //   1. drop the LiveKit room (createRoom may have succeeded);
    //   2. delete the session document we just persisted;
    //   3. revert the link's usedCount so a single_use link does not stay
    //      permanently exhausted by a transient room/token failure.
    // Each rollback step swallows its own error: the response is already a
    // 500 and we must not throw past the boundary.
    //
    // Concurrency note: step 3 is last-write-wins against the live counter,
    // so a concurrent successful claim that raised the counter past
    // `previousUsedCount` will be visually rolled back too. Functional safety
    // is preserved (the unique session $id, not the counter, gates the slot),
    // and the next request will simply re-scan from a lower `k` and skip
    // already-taken slots. An atomic compare-and-set would close this gap; it
    // is filed as a follow-up rather than introduced here.
    await deps.deleteRoom(sessionId).catch(() => {});
    await deps.deleteSession(sessionId).catch(() => {});
    if (claimedSlotIndex >= 0) {
      await deps.setUsedCount(link.$id, previousUsedCount).catch(() => {});
    }
    return { status: 500, body: { error: "internal_error" } };
  }
}
