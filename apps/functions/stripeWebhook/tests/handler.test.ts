import { describe, it, expect, vi } from "vitest";
import { stripeWebhook, type StripeWebhookDeps, type NormalizedStripeEvent } from "../src/handler";

const sub = {
  workspaceId: "ws_1", planKey: "pro" as const, status: "active" as const, seats: 5,
  stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  currentPeriodStart: "2026-06-01T00:00:00.000Z", currentPeriodEnd: "2026-07-01T00:00:00.000Z",
};
const updated: NormalizedStripeEvent = { id: "evt_1", type: "customer.subscription.updated", subscription: sub };

function makeDeps(over: Partial<StripeWebhookDeps> = {}): StripeWebhookDeps {
  return {
    verifyAndParse: vi.fn(async () => updated),
    isProcessed: vi.fn(async () => false),
    syncSubscription: vi.fn(async () => {}),
    markCanceled: vi.fn(async () => {}),
    markProcessed: vi.fn(async () => {}),
    ...over,
  };
}

describe("stripeWebhook (ADR 0006 M5) — verify + idempotency", () => {
  it("rejects an unverifiable payload with 400", async () => {
    const r = await stripeWebhook("{}", null, makeDeps({ verifyAndParse: vi.fn(async () => null) }));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "stripe_signature_invalid" });
  });

  it("syncs subscription on update and marks processed", async () => {
    const d = makeDeps();
    const r = await stripeWebhook("raw", "sig", d);
    expect(r.status).toBe(200);
    expect(d.syncSubscription).toHaveBeenCalledWith(sub);
    expect(d.markProcessed).toHaveBeenCalledWith("evt_1");
  });

  it("is idempotent: a replayed event is acked without re-applying", async () => {
    const d = makeDeps({ isProcessed: vi.fn(async () => true) });
    const r = await stripeWebhook("raw", "sig", d);
    expect(r.body).toEqual({ received: true, deduped: true });
    expect(d.syncSubscription).not.toHaveBeenCalled();
    expect(d.markProcessed).not.toHaveBeenCalled();
  });

  it("cancels on subscription.deleted", async () => {
    const d = makeDeps({
      verifyAndParse: vi.fn(async () => ({ id: "evt_2", type: "customer.subscription.deleted", subscription: sub })),
    });
    const r = await stripeWebhook("raw", "sig", d);
    expect(r.status).toBe(200);
    expect(d.markCanceled).toHaveBeenCalledWith("ws_1");
  });

  it("does not mark processed when applying fails (lets Stripe retry)", async () => {
    const d = makeDeps({ syncSubscription: vi.fn(async () => { throw new Error("db down"); }) });
    const r = await stripeWebhook("raw", "sig", d);
    expect(r.status).toBe(500);
    expect(d.markProcessed).not.toHaveBeenCalled();
  });
});
