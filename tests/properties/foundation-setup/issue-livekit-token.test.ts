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

  it("200 on first valid use of a single_use link", async () => {
    const { deps, sessions } = makeFake();
    const r = await issueLivekitToken({ linkToken: "valid" }, deps);
    expect(r.status).toBe(200);
    expect(sessions.size).toBe(1);
    if (r.status === 200) expect(r.body.token).toMatch(/^jwt\./);
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
