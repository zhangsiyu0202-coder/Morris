// Real deps: Stripe signature verification + event mapping; Appwrite projection.
// Integration-only. Secrets (STRIPE_*) read here, never in the pure core.
import Stripe from "stripe";
import { Client, Databases, Permission, Role } from "node-appwrite";
import type { StripeWebhookDeps, SubscriptionProjection } from "./handler.js";

const DB_ID = "merism";

function mapStatus(s: string): SubscriptionProjection["status"] {
  if (s === "trialing" || s === "active" || s === "past_due" || s === "canceled") return s;
  return s === "incomplete_expired" || s === "unpaid" ? "past_due" : "active";
}

function mapSubscription(event: Stripe.Event): SubscriptionProjection | null {
  if (!event.type.startsWith("customer.subscription.")) return null;
  const obj = event.data.object as Stripe.Subscription;
  const meta = obj.metadata ?? {};
  const item = obj.items?.data?.[0];
  // current_period_* live at the subscription level across the API versions we
  // target; narrow-cast (not `any`) to read them without coupling to the SDK
  // type's exact version shape.
  const periods = obj as unknown as { current_period_start: number; current_period_end: number };
  // Derive plan from the Stripe price id (robust to Customer-Portal changes that
  // bypass changePlan and therefore never refresh metadata); metadata fallback.
  const priceId = item?.price?.id;
  const planKey: SubscriptionProjection["planKey"] =
    priceId === process.env.STRIPE_PRICE_PRO
      ? "pro"
      : priceId === process.env.STRIPE_PRICE_PLUS
        ? "plus"
        : meta.planKey === "pro"
          ? "pro"
          : "plus";
  return {
    workspaceId: meta.workspaceId ?? "",
    planKey,
    status: mapStatus(obj.status),
    seats: item?.quantity ?? 1,
    stripeCustomerId: typeof obj.customer === "string" ? obj.customer : obj.customer.id,
    stripeSubscriptionId: obj.id,
    currentPeriodStart: new Date(periods.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(periods.current_period_end * 1000).toISOString(),
  };
}

async function upsertDoc(
  db: Databases,
  collectionId: string,
  documentId: string,
  data: Record<string, unknown>,
  permissions: string[],
): Promise<void> {
  try {
    await db.updateDocument(DB_ID, collectionId, documentId, data);
  } catch {
    await db.createDocument(DB_ID, collectionId, documentId, data, permissions);
  }
}

export function createRealDeps(): StripeWebhookDeps {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const db = new Databases(
    new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT ?? "")
      .setProject(process.env.APPWRITE_PROJECT_ID ?? "")
      .setKey(process.env.APPWRITE_API_KEY ?? ""),
  );

  return {
    async verifyAndParse(rawBody, signature) {
      if (!signature) return null;
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, whSecret);
      } catch {
        return null;
      }
      return { id: event.id, type: event.type, subscription: mapSubscription(event) };
    },
    async isProcessed(eventId) {
      try {
        await db.getDocument(DB_ID, "stripe_events", eventId);
        return true;
      } catch {
        return false;
      }
    },
    async syncSubscription(p) {
      await upsertDoc(db, "subscriptions", `sub_${p.workspaceId}`, { ...p }, [Permission.read(Role.team(p.workspaceId))]);
    },
    async markCanceled(workspaceId) {
      try {
        await db.updateDocument(DB_ID, "subscriptions", `sub_${workspaceId}`, { status: "canceled" });
      } catch {
        // subscription row may not exist; nothing to cancel.
      }
    },
    async markProcessed(eventId) {
      await db.createDocument(DB_ID, "stripe_events", eventId, { processedAt: new Date().toISOString() }, []);
    },
  };
}
