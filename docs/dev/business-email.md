# Business Email Service

This document covers Merism's custom business email path in `apps/web`.

It does **not** replace Appwrite's built-in auth email flow.

## Boundary

- Appwrite continues to handle auth verification / password reset / OTP email.
- `apps/web/lib/server/email-core.ts` provides a separate Nodemailer-based service for custom business email.
- `apps/web/lib/auth/actions.ts` currently uses that service only for the post-signup welcome email.

This split is intentional:

- Auth email stays on Appwrite's built-in flow.
- Product/business email uses a normal SMTP transport we fully control.

## Current provider

The service is designed around Nodemailer's SMTP transport.

QQ Mail works with either:

- `SMTP_SERVICE=QQ`
- or explicit host config such as `SMTP_HOST=smtp.qq.com`

Optional proxy support is available through:

- `SMTP_PROXY`
- `HTTP_PROXY`
- `HTTPS_PROXY`

## Required env vars

At minimum:

```bash
SMTP_SERVICE=QQ
SMTP_USER=your@qq.com
SMTP_PASSWORD=app-specific-password
SMTP_FROM_EMAIL=your@qq.com
APP_URL=http://localhost:3000
```

Common optional vars:

```bash
SMTP_FROM_NAME=Merism
SMTP_REPLY_TO=your@qq.com
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_REQUIRE_TLS=0
SMTP_POOL=1
SMTP_MAX_CONNECTIONS=5
SMTP_MAX_MESSAGES=100
SMTP_PROXY=http://127.0.0.1:7890
```

`APP_URL` is required for templates that embed absolute product links, such as the researcher welcome email.

## Idempotency ledger

Business email delivery state is persisted in the Appwrite collection:

- `email_deliveries`

The send path uses `campaignKey` as the logical idempotency key.

- If no `campaignKey` is provided, email is sent without persistence-backed deduplication.
- If a `campaignKey` is provided, the service derives a deterministic Appwrite document ID from it.
- First sender wins by `createDocument`.
- A second send with the same `campaignKey` returns `status: "duplicate"` and does not call SMTP again.

Stored statuses:

- `pending`
- `sent`
- `failed`

Important behavior:

- Deduplication is by `campaignKey`, not by recipient or template content.
- Reissuing a message intentionally requires a **new** `campaignKey`.
- If SMTP send succeeds but the `sent` status write-back fails, the API still returns `status: "sent"` and logs the persistence error. We do not rewrite a successfully delivered email to `failed`.

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

For a real SMTP check:

1. Put valid SMTP env vars in `.env`.
2. Run `pnpm schema:apply` once.
3. Trigger a real send with a fresh `campaignKey`.
4. Repeat with the same `campaignKey` and confirm the second send returns `duplicate`.

## Troubleshooting

If email returns `unavailable`:

- check `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`
- check that either `SMTP_SERVICE` or `SMTP_HOST` is set
- check `APP_URL` when the template needs absolute links

If SMTP hangs or handshake fails:

- verify outbound access to the SMTP host and port from the current machine
- try a proxy via `SMTP_PROXY` or `HTTPS_PROXY`
- confirm the mailbox uses an SMTP app password, not the login password

If deduplication blocks an intentional resend:

- generate a new `campaignKey`
