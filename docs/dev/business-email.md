# Business Email Service

This document covers Merism's custom business email path in `apps/web`.

It does **not** replace Appwrite's built-in auth email flow.

## Boundary

- Appwrite continues to handle auth verification / password reset / OTP email.
- `apps/web/lib/server/email-core.ts` provides a separate Resend-based service for custom business email.
- `apps/web/lib/auth/actions.ts` currently uses that service only for the post-signup welcome email.

This split is intentional:

- Auth email stays on Appwrite's built-in flow.
- Product/business email uses Resend's server-side API.

## Provider

The service uses the official Resend Node SDK. Before a real send, add and
verify a sender domain in Resend (SPF/DKIM as instructed by its dashboard),
then create a least-privilege sending key. Never expose the key to browser
code, logs, fixtures, or commits.

## Required env vars

At minimum:

```bash
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM_EMAIL=research@your-verified-domain.example
APP_URL=http://localhost:3000
```

Common optional vars:

```bash
RESEND_FROM_NAME=Merism
RESEND_REPLY_TO=research@your-verified-domain.example
```

`APP_URL` is required for templates that embed absolute product links, such as the researcher welcome email.

## Idempotency ledger

Business email delivery state is persisted in the Appwrite collection:

- `email_deliveries`

The send path uses `campaignKey` as the logical idempotency key.

- If no `campaignKey` is provided, email is sent without persistence-backed deduplication.
- If a `campaignKey` is provided, the service derives a deterministic Appwrite document ID from it.
- First sender wins by `createDocument`.
- A second send with the same `campaignKey` returns `status: "duplicate"` and does not call Resend again.
- The same deterministic key is also passed to Resend as its provider
  `Idempotency-Key`; the Appwrite ledger remains authoritative beyond the
  provider's shorter idempotency window.

Stored statuses:

- `pending`
- `sent`
- `failed`

Important behavior:

- Deduplication is by `campaignKey`, not by recipient or template content.
- Reissuing a message intentionally requires a **new** `campaignKey`.
- If Resend accepts the message but the `sent` status write-back fails, the API still returns `status: "sent"` and logs the persistence error. We do not rewrite a successfully accepted email to `failed`.

## Schema operations

After pulling this change, apply and verify Appwrite schema:

```bash
pnpm schema:apply
pnpm schema:verify
```

The `email_deliveries` collection is created by `packages/appwrite-schema/src/schema.ts`.

## Local verification

Targeted tests:

```bash
pnpm exec vitest run apps/web/lib/server/email.test.ts apps/web/lib/server/email.property.test.ts
pnpm -F @merism/web typecheck
pnpm -F @merism/appwrite-schema typecheck
```

For an opt-in real Resend check:

1. Verify the sender domain in Resend and put a sending key plus sender address in `.env`.
2. Run `pnpm schema:apply` once.
3. Trigger a real send to an operator-controlled address with a fresh `campaignKey`.
4. Repeat with the same `campaignKey` and confirm the second send returns `duplicate`.

## Troubleshooting

If email returns `unavailable`:

- check `RESEND_API_KEY` and `RESEND_FROM_EMAIL`
- check `APP_URL` when the template needs absolute links

If Resend rejects a request:

- confirm the sender domain is verified and the `from` address belongs to it
- confirm the API key has sending access for that domain
- inspect Resend's dashboard logs using the provider message id from the server log

If deduplication blocks an intentional resend:

- generate a new `campaignKey`
