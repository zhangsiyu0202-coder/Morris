import { describe, it, expect, vi } from "vitest";
import { changePlan, type ChangePlanDeps } from "../src/handler";

function makeDeps(over: Partial<ChangePlanDeps> = {}): ChangePlanDeps {
  return {
    callerUserId: "owner1",
    getCallerRole: vi.fn(async () => "owner" as const),
    createPlanChangeSession: vi.fn(async () => "https://checkout.stripe.com/c/sess_123"),
    ...over,
  };
}
const REQ = { workspaceId: "ws_1", targetPlan: "pro" as const };

describe("changePlan (ADR 0006 M5)", () => {
  it("returns a Stripe session URL for the owner", async () => {
    const d = makeDeps();
    const r = await changePlan(REQ, d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ url: "https://checkout.stripe.com/c/sess_123" });
    expect(d.createPlanChangeSession).toHaveBeenCalledWith("ws_1", "pro", "owner1");
  });

  it("rejects invalid input / unauthenticated", async () => {
    expect((await changePlan({ workspaceId: "ws_1", targetPlan: "enterprise" }, makeDeps())).status).toBe(400);
    expect((await changePlan(REQ, makeDeps({ callerUserId: null }))).status).toBe(401);
  });

  it("only the owner may change the plan (admin/member forbidden, non-member 403)", async () => {
    expect((await changePlan(REQ, makeDeps({ getCallerRole: vi.fn(async () => "admin") }))).status).toBe(403);
    expect((await changePlan(REQ, makeDeps({ getCallerRole: vi.fn(async () => null) }))).status).toBe(403);
  });

  it("maps Stripe failure to 500", async () => {
    const r = await changePlan(REQ, makeDeps({ createPlanChangeSession: vi.fn(async () => { throw new Error("stripe down"); }) }));
    expect(r.status).toBe(500);
  });
});
