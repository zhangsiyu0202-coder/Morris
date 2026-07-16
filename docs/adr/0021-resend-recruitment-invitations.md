# ADR 0021: Resend-backed, researcher-initiated recruitment invitations

Date: 2026-07-16

## Status

Accepted.

## Context

Merism currently has a server-only business-email utility backed by Nodemailer
SMTP. It can send welcome mail to a researcher, but the recruitment page only
manages anonymous interview links. It cannot present the study's recruitment
requirements or send an invitation whose content reflects those requirements.

`scope.md` excludes interviewee email and notification workflows unless an ADR
explicitly permits one. The request is intentionally narrow: a researcher must
be able to send a study invitation that states the eligible age range, gender
requirement, target participant count, and any participant-allocation notes.

## Decision

- Replace the business-mail transport with Resend's official Node SDK. The
  server reads `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, optional
  `RESEND_FROM_NAME`, and optional `RESEND_REPLY_TO`; no mail secret reaches
  the browser or logs.
- Extend the existing `Survey` with a typed `recruitmentCriteria` value,
  persisted as first-class `surveys` attributes. The criteria belongs to the
  existing study artifact; it is not a second survey, audience, campaign, or
  contact model.
- Permit only a researcher-initiated send from that study's recruitment page.
  The researcher manually provides recipient addresses for the current send.
  Merism does not import, scrape, or maintain an interviewee contact list and
  does not create interviewee accounts.
- The invitation renderer derives both HTML and plain-text content from the
  typed criteria and the selected active production `InterviewLink`. It does
  not use the realtime moderator instruction as recruitment content.
- Retain the existing `email_deliveries` deterministic-id ledger as the
  cross-request idempotency boundary, and add Resend's `Idempotency-Key` to
  cover provider retries within its documented retention period. A criteria
  revision produces a new invitation revision, while a repeated submission of
  the same revision is deduplicated.
- Send one recipient per provider request. This avoids disclosing other
  recipients and keeps the existing ledger's recipient-level idempotency
  semantics. The page limits a submission to Resend's documented 50-recipient
  request ceiling.
- Store only the existing delivery ledger fields needed for delivery tracing;
  the recruitment form's raw recipient list is never persisted as a contact
  collection or surfaced in a response. Provider errors are logged with a
  trace id and without addresses, message bodies, or API keys.

## Alternatives considered

### Keep SMTP and add a recruitment template

Rejected. The requested provider is Resend, whose SDK supplies a typed email
API and provider-level idempotency. Keeping an SMTP transport adds a second
configuration and failure surface without a product need.

### Store a per-interviewee email directory

Rejected. It would turn anonymous interview access into an identity-management
surface and conflicts with the project's accountless-interviewee boundary.

### Use Resend Contacts, Audiences, Broadcasts, or Automations

Rejected. The product needs an explicit, researcher-controlled invitation
action, not a persistent marketing/contact system. Those features would also
expand data-retention and consent responsibilities beyond this decision.

### Put recruitment requirements in `Survey.instruction` or `flowConfig`

Rejected. `instruction` is the runtime moderator document and `flowConfig` is
the governed interview-flow boundary. Recruitment eligibility is a distinct,
typed researcher-facing concern.

## Consequences

- Deployment must verify a sender domain in Resend and provide a least-
  privilege sending API key before real invitations can be delivered.
- Existing SMTP environment variables and Nodemailer dependencies are removed.
- The recruitment page gains a criteria editor and an explicit send form. A
  missing Resend configuration yields a controlled unavailable result; it does
  not pretend that mail was sent.
- This is the only permitted interviewee email workflow. Reminders, bulk
  marketing, recipient imports, automated sends, and lifecycle notifications
  require a separate ADR.

## Verification

- Unit and property tests cover criteria invariants, recipient parsing,
  injection-safe rendering, recipient-level deduplication, and provider error
  translation with a fake Resend client.
- Schema verification confirms the new `surveys` attributes against the local
  Appwrite stack.
- A true provider send is opt-in and runs only with an operator-supplied
  verified Resend domain and a local `RESEND_API_KEY`; no external email is
  sent in automated tests.

## References

- Resend send-email API: https://resend.com/docs/api-reference/emails/send-email
- Resend domain verification: https://resend.com/docs/dashboard/domains/introduction
- Official Node SDK: https://github.com/resend/resend-node
- Scope gate: `.kiro/steering/scope.md`.
