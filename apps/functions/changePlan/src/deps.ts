// Real deps: Stripe (Checkout) + Appwrite Teams (role lookup). Integration-only.
// Stripe is the source of truth for plan state; this only starts the session.
import Stripe from "stripe";
import { Client, Teams } from "node-appwrite";
import type { ChangePlanDeps } from "./handler.js";

export function createRealDeps(callerUserId: string | null): ChangePlanDeps {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT ?? "")
    .setProject(process.env.APPWRITE_PROJECT_ID ?? "")
    .setKey(process.env.APPWRITE_API_KEY ?? "");
  const teams = new Teams(client);

  return {
    callerUserId,
    async getCallerRole(workspaceId, userId) {
      try {
        // Native Teams is the role truth source (ADR-0006 D1; mirrors inviteMember).
        const res = await teams.listMemberships(workspaceId);
        const roles = res.memberships.find((m) => m.userId === userId)?.roles ?? [];
        if (roles.includes("owner")) return "owner";
        if (roles.includes("admin")) return "admin";
        if (roles.includes("member")) return "member";
        return null;
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
        // Propagate workspace identity onto the SUBSCRIPTION (not just the
        // Checkout session) so customer.subscription.* webhooks can resolve it.
        subscription_data: { metadata: { workspaceId, planKey: targetPlan } },
      });
      return session.url ?? "";
    },
  };
}
