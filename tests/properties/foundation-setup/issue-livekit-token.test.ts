// P-DATA-05 / P-SEC-03 (Properties 5, 17): issueLivekitToken concurrency &
// link-state invariants. Exercised against the pure handler with an in-memory
// store that models Appwrite's atomic unique-$id constraint. The same handler
// runs against the live stack in the smoke/CI integration path.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { issueLivekitToken } from "../../../apps/functions/issueLivekitToken/src/handler.js";
import { makeFake } from "./_fakes.js";

describe("issueLivekitToken status routing", () => {
  it("404 for unknown link, no session created", async () => {
    const { deps, sessions } = makeFake();
    const r = await issueLivekitToken({ linkToken: "nope" }, deps);
    expect(r.status).toBe(404);
    expect(sessions.size).toBe(0);
  });

  it("410 for expired link, no session created", async () => {
    const { deps, sessions } = makeFake({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(410);
    expect(sessions.size).toBe(0);
  });

  it("410 link_revoked when link.isRevoked is true, no session created", async () => {
    const { deps, sessions } = makeFake({ isRevoked: true });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(410);
    if (r.status === 410) expect(r.body.error).toBe("link_revoked");
    expect(sessions.size).toBe(0);
  });

  it("410 survey_not_published when surveyStatus is not published, no session created", async () => {
    const { deps, sessions } = makeFake({ surveyStatus: "paused" });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(410);
    if (r.status === 410) expect(r.body.error).toBe("survey_not_published");
    expect(sessions.size).toBe(0);
  });

  it("410 survey_not_published when surveyStatus is closed, no session created", async () => {
    const { deps, sessions } = makeFake({ surveyStatus: "closed" });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(410);
    if (r.status === 410) expect(r.body.error).toBe("survey_not_published");
    expect(sessions.size).toBe(0);
  });

  it("test-kind link bypasses publish gate on draft surveyStatus", async () => {
    const { deps, sessions } = makeFake({ kind: "test", surveyStatus: "draft" });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(200);
    expect(sessions.size).toBe(1);
  });

  it("test-kind link bypasses publish gate on paused surveyStatus", async () => {
    const { deps, sessions } = makeFake({ kind: "test", surveyStatus: "paused" });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(200);
    expect(sessions.size).toBe(1);
  });

  it("test-kind link still rejects closed surveyStatus", async () => {
    const { deps, sessions } = makeFake({ kind: "test", surveyStatus: "closed" });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(410);
    if (r.status === 410) expect(r.body.error).toBe("survey_not_published");
    expect(sessions.size).toBe(0);
  });

  it("test-kind link still rejects archived surveyStatus", async () => {
    const { deps, sessions } = makeFake({ kind: "test", surveyStatus: "archived" });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(410);
    if (r.status === 410) expect(r.body.error).toBe("survey_not_published");
    expect(sessions.size).toBe(0);
  });

  it("200 on first valid use of a single_use link", async () => {
    const { deps, sessions } = makeFake();
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(200);
    expect(sessions.size).toBe(1);
    if (r.status === 200) {
      expect(r.body.token).toMatch(/^jwt\./);
      expect(r.body.linkKind).toBe("production");
    }
  });

  it("200 response carries linkKind=test for researcher self-test links", async () => {
    const { deps } = makeFake({ kind: "test", surveyStatus: "draft" });
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body.linkKind).toBe("test");
  });

  it("createRoom failure rolls back session AND usedCount so the slot stays claimable", async () => {
    const { deps, sessions, link } = makeFake({ mode: "single_use", maxUses: 1 });
    deps.createRoom = async () => {
      throw new Error("livekit_unreachable");
    };

    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(500);
    if (r.status === 500) expect(r.body.error).toBe("internal_error");
    // Rollback: session must not persist, usedCount must revert. Otherwise a
    // single transient room/token failure would permanently exhaust a single_use
    // link and leak an orphaned session row.
    expect(sessions.size).toBe(0);
    expect(link.usedCount).toBe(0);
  });

  it("signToken failure rolls back session AND usedCount so the slot stays claimable", async () => {
    const { deps, sessions, link } = makeFake({ mode: "reusable", maxUses: 3 });
    // Bump usedCount to 1 to confirm rollback restores the *previous* value,
    // not zero.
    link.usedCount = 1;
    deps.signToken = async () => {
      throw new Error("signing_failed");
    };

    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(500);
    // P-SEC-04: response body is the flat registered code, no raw
    // exception text leaked from the catch block (symmetric with the
    // createRoom-failure case above; without this assertion the
    // `internal_error: ${err.message}` bug could regress on the
    // signToken path specifically).
    if (r.status === 500) expect(r.body.error).toBe("internal_error");
    expect(sessions.size).toBe(0);
    expect(link.usedCount).toBe(1);
  });

  // P-DATA-06: abandoned-but-charged slot reclaim. The pre-existing product
  // gap: handler increments usedCount the moment a token is issued, not when
  // the interviewee actually joins the room. If the interviewee takes a
  // token and never connects (closed the tab, denied mic permission, etc.),
  // the slot is consumed forever on a single_use link. The supervisor never
  // gets dispatched (LiveKit only dispatches a worker after first
  // participant connect), so session.state stays "created" — a reliable
  // orphan signal once the token TTL has expired.
  //
  // RECLAIM_GRACE_SECONDS = TOKEN_TTL_SECONDS + 60 ensures we only reclaim
  // sessions whose original token can no longer connect. This makes the
  // reclaim race-free without needing caller identification.
  it("reclaims orphan slot on next click after grace period (single_use link)", async () => {
    const { deps, sessions, link } = makeFake({ mode: "single_use", maxUses: 1 });

    // First click: token issued, slot 0 claimed
    const r1 = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r1.status).toBe(200);
    expect(link.usedCount).toBe(1);
    expect(sessions.size).toBe(1);

    // Interviewee never joins. Simulate time passing past the grace cutoff
    // by backdating the orphan session's createdAt.
    const orphan = sessions.get("s_link1_0")!;
    orphan.createdAtMs = Date.now() - (31 * 60 + 1) * 1000; // 31min + 1s ago
    // state stays "created" — agent worker never dispatched

    // Second click: handler should reclaim slot 0 and re-issue
    const r2 = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r2.status).toBe(200);
    expect(link.usedCount).toBe(1);     // still 1, not 2 (slot 0 reclaimed)
    expect(sessions.size).toBe(1);      // old session deleted, new one created
    if (r2.status === 200) {
      expect(r2.body.sessionId).toBe("s_link1_0"); // same slot id reused
    }
  });

  it("does NOT reclaim recent orphan within grace period (single_use link)", async () => {
    const { deps, link } = makeFake({ mode: "single_use", maxUses: 1 });

    const r1 = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r1.status).toBe(200);
    expect(link.usedCount).toBe(1);

    // No backdating — orphan is fresh (token still potentially valid).
    // Second click within grace period MUST NOT reclaim — the original
    // interviewee could still connect with their valid token.
    const r2 = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r2.status).toBe(410);
    if (r2.status === 410) expect(r2.body.error).toBe("link_exhausted");
  });

  it("does NOT reclaim session whose state advanced to in_progress", async () => {
    const { deps, sessions, link } = makeFake({ mode: "single_use", maxUses: 1 });

    const r1 = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r1.status).toBe(200);

    // Interviewee joined; agent worker promoted state. Backdate to past
    // grace — even an old session must NOT be reclaimed once it has moved
    // off "created" because the interview may still be running or already
    // produced data.
    const active = sessions.get("s_link1_0")!;
    active.state = "in_progress";
    active.createdAtMs = Date.now() - (60 * 60) * 1000; // 1h ago

    const r2 = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r2.status).toBe(410);
    if (r2.status === 410) expect(r2.body.error).toBe("link_exhausted");
    expect(link.usedCount).toBe(1);
  });

  it("reclaims multiple orphan slots on reusable link, link.usedCount decrements once per orphan", async () => {
    const { deps, sessions, link } = makeFake({ mode: "reusable", maxUses: 3 });

    // Claim 3 slots; all become orphans (none ever joined)
    for (let i = 0; i < 3; i++) {
      const r = await issueLivekitToken({ linkToken: "valid" }, deps);
      expect(r.status).toBe(200);
    }
    expect(link.usedCount).toBe(3);
    expect(sessions.size).toBe(3);

    // Backdate all 3 past grace
    const stale = Date.now() - (31 * 60 + 1) * 1000;
    for (const row of sessions.values()) row.createdAtMs = stale;

    // 4th click: handler should reclaim all 3 orphans, then issue a fresh
    // slot 0 (back to the start of the loop after reclaim resets state).
    const r4 = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r4.status).toBe(200);
    expect(link.usedCount).toBe(1); // 3 reclaimed, 1 newly claimed -> 1
    expect(sessions.size).toBe(1);  // 3 orphans deleted + 1 new -> 1
  });

  // P-SEC-04 (companion to P-SEC-03): error responses MUST NOT leak raw
  // exception text through the body. Per errors-and-observability.md the
  // client-facing error field is restricted to the registered code set.
  // Without this guard a future catch handler could `error: \`internal_error:
  // \${err.message}\`` and ship a livekit URL / token / db path to the
  // interviewee's browser. The bug this prevents shipped once
  // (commit prior to this test) — keep the assertion so it cannot recur.
  it("all error responses carry a registered code, never a raw message", async () => {
    const REGISTERED_CODES = new Set([
      "invalid_input",
      "link_not_found",
      "link_expired",
      "link_revoked",
      "link_exhausted",
      "survey_not_published",
      "quota_exceeded",
      "internal_error",
    ]);

    // 1. invalid input
    {
      const { deps } = makeFake();
      const r = await issueLivekitToken({ linkToken: "" }, deps);
      if (r.status !== 200) {
        expect(REGISTERED_CODES.has(r.body.error)).toBe(true);
        expect(r.body.error).not.toMatch(/[:\s]/);
      }
    }
    // 2. unknown link
    {
      const { deps } = makeFake();
      const r = await issueLivekitToken({ linkToken: "missing" }, deps);
      if (r.status !== 200) {
        expect(REGISTERED_CODES.has(r.body.error)).toBe(true);
        expect(r.body.error).not.toMatch(/[:\s]/);
      }
    }
    // 3. createRoom failure (the historical bug site)
    {
      const { deps } = makeFake({ mode: "single_use", maxUses: 1 });
      deps.createRoom = async () => {
        throw new Error("livekit_unreachable: rest endpoint 503 (key=sk_live_abc)");
      };
      const r = await issueLivekitToken({ linkToken: "valid" }, deps);
      if (r.status !== 200) {
        expect(REGISTERED_CODES.has(r.body.error)).toBe(true);
        expect(r.body.error).not.toMatch(/[:\s]/);
        expect(r.body.error).not.toContain("livekit_unreachable");
        expect(r.body.error).not.toContain("sk_live_");
      }
    }
    // 4. signToken failure
    {
      const { deps } = makeFake({ mode: "reusable", maxUses: 3 });
      deps.signToken = async () => {
        throw new Error("jwt sign failed: secret=hunter2");
      };
      const r = await issueLivekitToken({ linkToken: "valid" }, deps);
      if (r.status !== 200) {
        expect(REGISTERED_CODES.has(r.body.error)).toBe(true);
        expect(r.body.error).not.toMatch(/[:\s]/);
        expect(r.body.error).not.toContain("hunter2");
      }
    }
  });
});

describe("P-DATA-05: single_use link is claimed exactly once under concurrency", () => {
  it("N concurrent calls -> exactly 1 success, 1 session", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 25 }), async (n) => {
        const { deps, sessions } = makeFake({ mode: "single_use", maxUses: 1 });
        const results = await Promise.all(
          Array.from({ length: n }, () => issueLivekitToken({ linkToken: "valid" }, deps)),
        );
        const ok = results.filter((r) => r.status === 200);
        const gone = results.filter((r) => r.status === 410);
        expect(ok.length).toBe(1);
        expect(gone.length).toBe(n - 1);
        expect(sessions.size).toBe(1);
      }),
    );
  });
});

describe("P-DATA-05: reusable link never exceeds maxUses", () => {
  it("usedCount <= maxUses and successes == min(N, maxUses)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 20 }),
        async (maxUses, n) => {
          const { deps, sessions, link } = makeFake({ mode: "reusable", maxUses });
          const results = await Promise.all(
            Array.from({ length: n }, () => issueLivekitToken({ linkToken: "valid" }, deps)),
          );
          const ok = results.filter((r) => r.status === 200).length;
          expect(ok).toBe(Math.min(n, maxUses));
          expect(sessions.size).toBe(Math.min(n, maxUses));
          expect(link.usedCount).toBeLessThanOrEqual(maxUses);
        },
      ),
    );
  });
});
