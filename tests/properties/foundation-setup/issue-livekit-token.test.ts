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
    expect(sessions.size).toBe(0);
    expect(link.usedCount).toBe(1);
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
