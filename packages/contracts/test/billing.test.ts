import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  WorkspaceSchema,
  WorkspaceMembershipSchema,
  WorkspaceRole,
  PlanSchema,
  SubscriptionSchema,
  UsageEventSchema,
  usageEventId,
  UsageCounterSchema,
  QuotaStateSchema,
  isBillableInterview,
  hardCeilingFor,
  COMPLETED_INTERVIEW_MIN_DURATION_MS,
  QUOTA_HARD_CEILING_MULTIPLE,
} from "@merism/contracts";

const T0 = "2026-06-11T00:00:00.000Z";
const T1 = "2026-07-11T00:00:00.000Z";

describe("contracts: Workspace & membership (ADR 0006)", () => {
  it("parses a workspace", () => {
    const w = WorkspaceSchema.parse({
      $id: "ws_1", name: "Acme", ownerUserId: "u1", planKey: "plus",
      createdAt: T0, updatedAt: T0,
    });
    expect(w.planKey).toBe("plus");
  });

  it("membership defaults status to invited", () => {
    const m = WorkspaceMembershipSchema.parse({
      $id: "m_1", workspaceId: "ws_1", userId: "u2", role: "member", createdAt: T0,
    });
    expect(m.status).toBe("invited");
  });

  it("rejects an unknown role", () => {
    expect(WorkspaceRole.options).toContain("owner");
    expect(
      WorkspaceMembershipSchema.safeParse({
        $id: "m_1", workspaceId: "ws_1", userId: "u2", role: "editor", createdAt: T0,
      }).success,
    ).toBe(false);
  });
});

describe("contracts: Plan & Subscription", () => {
  it("plan defaults features to []", () => {
    expect(PlanSchema.parse({ key: "plus", includedInterviews: 50 }).features).toEqual([]);
  });

  it("accepts a valid subscription period and rejects an inverted one", () => {
    expect(
      SubscriptionSchema.safeParse({
        $id: "sub_1", workspaceId: "ws_1", planKey: "pro", status: "active",
        seats: 3, currentPeriodStart: T0, currentPeriodEnd: T1,
      }).success,
    ).toBe(true);
    expect(
      SubscriptionSchema.safeParse({
        $id: "sub_1", workspaceId: "ws_1", planKey: "pro", status: "active",
        seats: 3, currentPeriodStart: T1, currentPeriodEnd: T0,
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive seats", () => {
    expect(
      SubscriptionSchema.safeParse({
        $id: "sub_1", workspaceId: "ws_1", planKey: "pro", status: "active",
        seats: 0, currentPeriodStart: T0, currentPeriodEnd: T1,
      }).success,
    ).toBe(false);
  });
});

describe("contracts: Usage & quota", () => {
  it("usage event defaults unit and the id is the dedup gate", () => {
    const e = UsageEventSchema.parse({
      $id: usageEventId("s1"), workspaceId: "ws_1", studyId: "sv1", sessionId: "s1", occurredAt: T0,
    });
    expect(e.unit).toBe("completed_interview");
    expect(usageEventId("s1")).toBe("ue_s1");
    expect(usageEventId("s1")).toBe(usageEventId("s1"));
  });

  it("usage counter rejects an inverted period", () => {
    expect(
      UsageCounterSchema.safeParse({
        $id: "uc_1", workspaceId: "ws_1", periodStart: T1, periodEnd: T0, completedInterviews: 0,
      }).success,
    ).toBe(false);
  });

  it("quota state defaults to ok and rejects ceiling < included", () => {
    const q = QuotaStateSchema.parse({
      workspaceId: "ws_1", periodEnd: T1, usedInterviews: 3, includedInterviews: 50, hardCeiling: 100,
    });
    expect(q.state).toBe("ok");
    expect(
      QuotaStateSchema.safeParse({
        workspaceId: "ws_1", periodEnd: T1, usedInterviews: 3, includedInterviews: 50, hardCeiling: 40,
      }).success,
    ).toBe(false);
  });
});

describe("contracts: billing predicates", () => {
  it("hardCeilingFor is the configured multiple", () => {
    expect(hardCeilingFor(50)).toBe(50 * QUOTA_HARD_CEILING_MULTIPLE);
  });

  it("isBillableInterview enforces state + duration + answers", () => {
    const ok = { state: "completed", durationMs: COMPLETED_INTERVIEW_MIN_DURATION_MS, answeredCount: 1 };
    expect(isBillableInterview(ok)).toBe(true);
    expect(isBillableInterview({ ...ok, state: "abandoned" })).toBe(false);
    expect(isBillableInterview({ ...ok, durationMs: 1000 })).toBe(false);
    expect(isBillableInterview({ ...ok, answeredCount: 0 })).toBe(false);
  });

  it("round-trips a subscription for any valid seats", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.constantFrom("plus", "pro"), (seats, planKey) => {
        const row = {
          $id: "sub_x", workspaceId: "ws_1", planKey, status: "active" as const,
          seats, currentPeriodStart: T0, currentPeriodEnd: T1,
        };
        const once = SubscriptionSchema.parse(row);
        expect(SubscriptionSchema.parse(once)).toEqual(once);
      }),
    );
  });
});
