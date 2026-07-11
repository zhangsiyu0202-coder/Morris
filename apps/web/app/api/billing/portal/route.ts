import Stripe from "stripe"
import { Databases, Teams } from "node-appwrite"
import { sessionClient, readSessionSecret } from "@/lib/auth/appwrite"

const DB_ID = "merism"

function redirectTo(req: Request, path: string, params?: Record<string, string>): Response {
  const url = new URL(path, req.url)
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }
  return Response.redirect(url)
}

export async function GET(req: Request) {
  const secret = await readSessionSecret().catch(() => null)
  if (!secret) {
    return redirectTo(req, "/login", {
      callbackUrl: "/settings/billing",
      portal: "session_expired",
    })
  }

  const client = sessionClient(secret)
  const teams = new Teams(client)
  const db = new Databases(client)
  const stripeSecret = process.env.STRIPE_SECRET_KEY
  if (!stripeSecret) {
    return redirectTo(req, "/settings/billing", { portal: "misconfigured" })
  }

  const team = (await teams.list()).teams[0]
  if (!team) {
    return redirectTo(req, "/settings/billing", { portal: "forbidden" })
  }

  let stripeCustomerId: string | null = null
  try {
    const subscription = (await db.getDocument(DB_ID, "subscriptions", `sub_${team.$id}`)) as {
      stripeCustomerId?: string
    }
    stripeCustomerId = subscription.stripeCustomerId ?? null
  } catch {
    stripeCustomerId = null
  }

  if (!stripeCustomerId) {
    return redirectTo(req, "/settings/billing", { portal: "unavailable" })
  }

  try {
    const stripe = new Stripe(stripeSecret)
    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: new URL("/settings/billing", req.url).toString(),
    })

    return Response.redirect(portal.url)
  } catch {
    return redirectTo(req, "/settings/billing", { portal: "unavailable" })
  }
}
