// Real deps: Stripe (Checkout) + Appwrite (role lookup). Integration-only.
// Stripe is the source of truth for plan state; this only starts the session.
import Stripe from "stripe";
import { Client, Databases } from "node-appwrite";
import type { ChangePlanDeps } from "./handler.js";

const DB_ID = "merism";

function resolveRole(doc: unknown): "owner" | "admin" | "member" | null {
  const r = (doc as { role?: string }).role;
  return r === "owner" || r === "admin" || r === "member" ? r : null;
}

export function createRealDeps(callerUserId: string | null): ChangePlanDeps {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  const db = new Databases(
    new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT ?? "")
      .setProject(process.env.APPWRITE_PROJECT_ID ?? "")
      .setKey(process.env.APPWRITE_API_KEY ?? ""),
  );

  return {
    callerUserId,
    async getCallerRole(workspaceId, userId) {
      try {
        return resolveRole(await db.getDocument(DB_ID, "workspace_memberships", `m_${workspaceId}_${userId}`));
      } catch {
        return null;
      }
    },
    async createPlanChangeSession(workspaceId, targetPlan, ownerUserId) {
      const price = targetPlan === "pro" ? (process.env.STRIPE_PRICE_PRO ?? "") : (process.env.STRIPE_PRICE_PLUS ?? "");
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        success_url: process.env.STRIPE_SUCCESS_URL ?? "",
        cancel_url: process.env.STRIPE_CANCEL_URL ?? "",
        client_reference_id: workspaceId,
        metadata: { workspaceId, ownerUserId, planKey: targetPlan },
      });
      return session.url ?? "";
    },
  };
}
