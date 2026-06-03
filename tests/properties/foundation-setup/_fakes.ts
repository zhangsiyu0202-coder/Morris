// In-memory IssueDeps that faithfully models the one invariant the handler
// relies on: session $id uniqueness is atomic (createSession returns false on
// collision), exactly like Appwrite's document-id constraint. Used by the
// concurrency (P-DATA-05) and secret-leak (P-SEC-02) property tests.
import type { IssueDeps, LinkRecord, SessionInit } from "../../../apps/functions/issueLivekitToken/src/handler.js";

export const KNOWN_SECRET = "TEST_SECRET_LEAK_GUARD_a1b2c3d4e5";

export interface Fake {
  deps: IssueDeps;
  sessions: Map<string, SessionInit>;
  link: LinkRecord;
}

export function makeFake(link: Partial<LinkRecord> = {}): Fake {
  const sessions = new Map<string, SessionInit>();
  const full: LinkRecord = {
    $id: "link1",
    surveyId: "survey1",
    ownerUserId: "owner1",
    mode: "single_use",
    maxUses: 1,
    usedCount: 0,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...link,
  };
  const deps: IssueDeps = {
    livekitUrl: "ws://localhost:7880",
    now: () => Date.now(),
    findLink: async (token) => (token === "valid" ? full : null),
    // Atomic check-and-set: no await between has() and set().
    createSession: async (id, data) => {
      if (sessions.has(id)) return false;
      sessions.set(id, data);
      return true;
    },
    deleteSession: async (id) => {
      sessions.delete(id);
    },
    setUsedCount: async (_id, count) => {
      full.usedCount = Math.max(full.usedCount, count);
    },
    getSurveyMeta: async (surveyId) => ({ surveyId, title: "Demo Survey" }),
    createRoom: async (_room, _metadata) => {},
    deleteRoom: async () => {},
    // Real LiveKit JWTs are HMAC-signed; the secret is never embedded in the
    // token. The fake returns a token derived WITHOUT exposing the secret.
    signToken: async (a) => `jwt.${Buffer.from(a.room).toString("base64url")}.sig`,
  };
  return { deps, sessions, link: full };
}
