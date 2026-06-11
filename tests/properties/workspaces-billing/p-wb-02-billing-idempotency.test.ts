import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { usageEventId } from "@merism/contracts";

/**
 * P-WB-02 — Billing idempotency (ADR 0006 FR-U1).
 * The billable id is a pure deterministic function of sessionId, so a session
 * is billed at most once regardless of retries/concurrency: the count of
 * distinct event ids equals the count of distinct sessions.
 */
describe("P-WB-02 billing idempotency", () => {
  it("usageEventId is deterministic and 1:1 with sessionId", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(usageEventId(s)).toBe(usageEventId(s));
        expect(usageEventId(s)).toBe(`ue_${s}`);
      }),
    );
  });

  it("distinct sessions map to distinct ids (no double-bill, no collision)", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 50 }), (sessions) => {
        const distinctSessions = new Set(sessions);
        const ids = new Set(sessions.map(usageEventId));
        expect(ids.size).toBe(distinctSessions.size);
      }),
    );
  });
});
