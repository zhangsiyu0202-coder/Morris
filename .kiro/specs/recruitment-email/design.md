# Design Document: recruitment-email

## Data flow

```text
RecruitView
  -> saveRecruitmentCriteria (author gate)
  -> surveys primitive attributes

RecruitView + manual recipients + active production link
  -> sendRecruitmentInvitations (author gate)
  -> renderRecruitmentInvitation
  -> sendEmail (Resend SDK + email_deliveries CAS)
  -> Resend
```

No browser code accesses Resend or Appwrite with a server key. The raw
recipient textarea is sent only to the server action and is not persisted as a
recipient directory.

## Contract and persistence

`RecruitmentCriteriaSchema` lives in `packages/contracts/src/entities.ts` and
is referenced by `SurveySchema` as `recruitmentCriteria`. It has these fields:

- `minAge?: number`
- `maxAge?: number`
- `genderRequirement: string`
- `targetParticipantCount: number`
- `participantAllocationNotes: string`
- `updatedAt?: datetime`

The cross-field age ordering invariant is implemented with `superRefine`.
Appwrite stores the primitive values as attributes on `surveys`, including a
criteria-update timestamp. This keeps the root study as the artifact that owns
its recruiting requirements and avoids an untyped JSON field.

## Provider boundary

`apps/web/lib/server/email-core.ts` keeps its public `sendEmail` template
boundary and durable delivery ledger but swaps the transport implementation to
`Resend.emails.send`. The provider adapter accepts only rendered HTML/text,
sanitized headers, and the configured sender. It maps the returned Resend id to
the existing `messageId` result.

The deterministic ledger remains authoritative longer than Resend's provider
idempotency interval. A campaign key is hashed to an Appwrite document id and
also sent as Resend's request idempotency key. The invitation-specific campaign
key includes `surveyId`, selected `linkId`, criteria update timestamp, and a
normalized recipient hash. This permits a new invitation after criteria change
while preventing a double click from sending twice.

## Invitation boundary

`apps/web/lib/server/recruitment-invitation.ts` is a pure renderer. It accepts
typed criteria, a safe public interview URL, and study title; it creates both
plain text and HTML. All researcher-entered content passes through the existing
template context sanitizer before interpolation. The renderer has no Appwrite,
environment, or provider dependency and is covered directly by tests.

`apps/web/lib/actions/recruitment.ts` owns server-side validation, author
checks, active-link checks, recipient parsing, criteria writes, and the loop
over recipients. It has no client-visible secrets. Each send result is reduced
to counts and safe status strings for the UI.

## Errors and observability

- Invalid criteria or recipient input fails before any send.
- A missing Resend config returns `unavailable` and leaves no delivery claim.
- A provider failure marks the ledger `failed` then throws `EmailTransportError`.
- A delivery writeback failure is explicitly best-effort after the provider has
  accepted the message; the sent result is retained and the failure is logged.
- Logs include a request trace id, study id, provider message id, and aggregate
  counts only. They never include `RESEND_API_KEY`, recipient address, subject,
  or rendered body.

## Alternatives rejected

- `Survey.instruction` / `flowConfig`: runtime interview data, not eligibility.
- A recipient/contact collection: violates the anonymous-interviewee boundary.
- Batch or broadcast sends: obscures recipient-level deduplication and risks
  address disclosure; individual sends are within this feature's small,
  researcher-controlled scope.
