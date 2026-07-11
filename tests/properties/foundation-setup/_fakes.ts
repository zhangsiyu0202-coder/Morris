// In-memory IssueDeps that faithfully models the invariants the handler
// relies on:
//   1. Session $id uniqueness is atomic (createSession returns false on
//      collision), exactly like Appwrite's document-id constraint. Drives
//      the concurrency (P-DATA-05) and secret-leak (P-SEC-02) property tests.
//   2. Sessions carry a state ("created" -> "in_progress" -> ...) and an
//      implicit `$createdAt` timestamp so the reclaim-orphan-slots test can
//      simulate an interviewee who took a token but never joined the room.
import type { IssueDeps, LinkRecord, SessionInit } from "../../../apps/functions/issueLivekitToken/src/handler.js";

export const KNOWN_SECRET = "TEST_SECRET_LEAK_GUARD_a1b2c3d4e5";

/** Internal session row, including bookkeeping fields the real Appwrite
 *  document carries that the handler uses to detect orphans. */
export interface FakeSessionRow {
  data: SessionInit;
  state: "created" | "in_progress" | "completed" | "abandoned" | "failed";
  createdAtMs: number;
}

export interface Fake {
  deps: IssueDeps;
  /** Direct view of the in-memory session table. Mutate `.state` /
   *  `.createdAtMs` to simulate post-handler activity (e.g. agent worker
   *  promoting a session to "in_progress", or a stale orphan session
   *  created N minutes ago). */
  sessions: Map<string, FakeSessionRow>;
  link: LinkRecord;
}

export function makeFake(link: Partial<LinkRecord> = {}): Fake {
  const sessions = new Map<string, FakeSessionRow>();
  const full: LinkRecord = {
    $id: "link1",
    surveyId: "survey1",
    ownerUserId: "owner1",
    mode: "single_use",
    kind: "production",
    maxUses: 1,
    usedCount: 0,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    isRevoked: false,
    surveyStatus: "published",
    ...link,
  };
  const deps: IssueDeps = {
    livekitUrl: "ws://localhost:7880",
    now: () => Date.now(),
    findLink: async (token) => (token === "valid" ? full : null),
    // Atomic check-and-set: no await between has() and set().
    createSession: async (id, data) => {
      if (sessions.has(id)) return false;
      sessions.set(id, {
        data,
        state: "created",
        createdAtMs: Date.now(),
      });
      return true;
    },
    deleteSession: async (id) => {
      sessions.delete(id);
    },
    setUsedCount: async (_id, count) => {
      // last-write-wins, mirroring Appwrite's updateDocument semantics.
      full.usedCount = count;
    },
    getSurveyMeta: async (surveyId) => ({ surveyId, title: "Demo Survey" }),
    createRoom: async (_room, _metadata) => {},
    deleteRoom: async () => {},
    // Find sessions on this link that are confirmed orphans: state stuck at
    // "created" (agent worker never promoted to "in_progress" => no one ever
    // joined the room) AND older than the grace cutoff (token TTL has
    // expired, so the original token can no longer connect).
    listOrphanSessions: async (linkId, olderThanMs) => {
      const cutoff = Date.now() - olderThanMs;
      const ids: string[] = [];
      for (const [id, row] of sessions) {
        if (
          row.data.linkId === linkId &&
          row.state === "created" &&
          row.createdAtMs < cutoff
        ) {
          ids.push(id);
        }
      }
      return ids;
    },
    // Real LiveKit JWTs are HMAC-signed; the secret is never embedded in the
    // token. The fake returns a token derived WITHOUT exposing the secret.
    signToken: async (a) => `jwt.${Buffer.from(a.room).toString("base64url")}.sig`,
  };
  return { deps, sessions, link: full };
}
