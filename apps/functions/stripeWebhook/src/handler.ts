// Pure stripeWebhook core (ADR 0006 M5). Signature verification + Stripe event
// parsing live behind deps (no stripe import here) so the core is unit-testable.
// Two invariants (FR-B3): (1) reject unverifiable payloads; (2) apply each event
// at most once (idempotent on the Stripe event id) so replays/duplicates are safe.

export interface SubscriptionProjection {
  workspaceId: string;
  planKey: "plus" | "pro";
  status: "trialing" | "active" | "past_due" | "canceled";
  seats: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

/** Normalized event the deps layer produces from a verified Stripe event. */
export interface NormalizedStripeEvent {
  id: string;
  type: string;
  /** Present for customer.subscription.* events. */
  subscription: SubscriptionProjection | null;
}

export interface StripeWebhookDeps {
  /** Verify the signature and normalize; null if verification fails. */
  verifyAndParse(rawBody: string, signature: string | null): Promise<NormalizedStripeEvent | null>;
  isProcessed(eventId: string): Promise<boolean>;
  syncSubscription(p: SubscriptionProjection): Promise<void>;
  markCanceled(workspaceId: string): Promise<void>;
  markProcessed(eventId: string): Promise<void>;
}

export type StripeWebhookResult =
  | { status: 200; body: { received: true; deduped?: true } }
  | { status: 400 | 500; body: { error: string } };

export async function stripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: StripeWebhookDeps,
): Promise<StripeWebhookResult> {
  const event = await deps.verifyAndParse(rawBody, signature);
  if (!event) return { status: 400, body: { error: "stripe_signature_invalid" } };

  // Idempotency: a replayed/duplicate event id is acknowledged without re-applying.
  if (await deps.isProcessed(event.id)) return { status: 200, body: { received: true, deduped: true } };

  try {
    if (event.type.startsWith("customer.subscription.") && event.subscription) {
      if (event.type === "customer.subscription.deleted") {
        await deps.markCanceled(event.subscription.workspaceId);
      } else {
        await deps.syncSubscription(event.subscription);
      }
    }
    await deps.markProcessed(event.id);
    return { status: 200, body: { received: true } };
  } catch {
    // Do NOT mark processed on failure -> Stripe retries the event.
    return { status: 500, body: { error: "internal_error" } };
  }
}
