/**
 * Seed the `plans` catalog (Plus / Pro) so billing reads + createWorkspace's
 * quota seeding resolve a real allowance instead of falling back to 0
 * (ADR-0006 D4; values per the prd-pricing.md "pricing locked" update).
 *
 * Entitlements only — dollar amounts live in Stripe and are referenced by
 * `priceRef` (override via STRIPE_PRICE_PLUS / STRIPE_PRICE_PRO when Stripe is
 * wired; placeholders until then). Idempotent: doc id === planKey, create then
 * update so re-running refreshes the allowance/features. Local/dev + ops.
 *
 * Usage:
 *   set -a && . ./.env && set +a && pnpm exec tsx scripts/seed-plans.ts
 */
import { Client, Databases } from "node-appwrite";

const DB = "merism";
const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT!)
  .setProject(process.env.APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
const db = new Databases(client);

const PLANS = [
  {
    key: "plus" as const,
    includedInterviews: 50,
    features: ["core"] as const,
    priceRef: process.env.STRIPE_PRICE_PLUS ?? "price_plus_placeholder",
  },
  {
    key: "pro" as const,
    includedInterviews: 200,
    features: ["core", "visual_analysis", "survey_rollup"] as const,
    priceRef: process.env.STRIPE_PRICE_PRO ?? "price_pro_placeholder",
  },
];

function isConflict(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && (e as { code?: number }).code === 409);
}

async function main(): Promise<void> {
  for (const raw of PLANS) {
    // Shape mirrors the `plans` collection (key/includedInterviews/features/
    // priceRef) and PlanSchema in packages/contracts/src/billing.ts; the enum
    // attributes enforce the value sets server-side on write.
    const body = {
      key: raw.key,
      includedInterviews: raw.includedInterviews,
      features: [...raw.features],
      priceRef: raw.priceRef,
    };
    try {
      await db.createDocument(DB, "plans", raw.key, body);
      console.log(`[seed-plans] created ${raw.key} (included=${raw.includedInterviews})`);
    } catch (e) {
      if (!isConflict(e)) throw e;
      await db.updateDocument(DB, "plans", raw.key, body);
      console.log(`[seed-plans] updated ${raw.key} (included=${raw.includedInterviews})`);
    }
  }
  console.log("[seed-plans] done.");
}

main().catch((err) => {
  console.error("[seed-plans] failed:", err);
  process.exit(1);
});
