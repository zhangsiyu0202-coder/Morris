# Requirements Document

## Feature: recruitment-email

## Introduction

This spec implements the narrow invitation workflow enabled by ADR-0021. A
researcher records recruitment eligibility on an existing Survey, then manually
enters recipients and explicitly sends a study invitation through Resend.

The feature does not create interviewee accounts, a contact database, an
automated notification system, or an external recruitment integration.

## Requirements

### Requirement 1: Typed recruitment criteria

**User story:** As a researcher, I need to record the eligibility requirements
for a study so an invitation accurately describes whom it is for.

#### Acceptance criteria

1. `packages/contracts` SHALL define `RecruitmentCriteriaSchema` and export
   its inferred type.
2. The criteria SHALL include optional minimum and maximum age, a free-form
   gender requirement, a positive target participant count, and free-form
   participant-allocation notes.
3. The schema SHALL reject a maximum age lower than the minimum age and a
   non-positive target participant count when one is supplied.
4. The Survey entity SHALL expose the typed criteria and Appwrite SHALL store
   its primitive fields as `surveys` attributes, not a new JSON bucket.

### Requirement 2: Resend business-mail provider

**User story:** As an operator, I need the mail service to use Resend instead
of SMTP so deployments have one supported provider configuration.

#### Acceptance criteria

1. The web server SHALL use Resend's official Node SDK and SHALL not retain a
   Nodemailer runtime dependency.
2. A message SHALL be unavailable unless the Resend key and sender address are
   configured. The unavailable result SHALL identify configuration, not claim
   successful delivery.
3. The existing `email_deliveries` ledger SHALL remain the durable,
   recipient-level idempotency gate. The provider request SHALL also carry an
   `Idempotency-Key` derived from the same campaign key.
4. Provider errors SHALL mark the ledger failed and throw a named error without
   logging secrets, raw recipient addresses, or rendered message content.

### Requirement 3: Researcher-controlled invitation delivery

**User story:** As a researcher, I need to send a clear invitation from the
recruitment page after selecting an active production interview link.

#### Acceptance criteria

1. The recruitment page SHALL let the study author save its recruitment
   criteria and choose an active, unrevoked production link.
2. The researcher SHALL manually enter at most 50 valid recipients, separated
   by a comma or line break. The raw input SHALL not be saved as a contact list.
3. Each recipient SHALL receive a distinct message containing the study title,
   eligibility requirements, participant target, allocation notes when present,
   and the selected anonymous interview link.
4. A repeated submission with unchanged criteria and link SHALL return a
   recipient-level duplicate outcome instead of another provider call. A saved
   criteria change SHALL produce a new invitation revision.
5. The action SHALL authorize the study author before reading criteria or
   sending mail. It SHALL reject test, revoked, expired, or exhausted links.

### Requirement 4: Verification and operations

#### Acceptance criteria

1. Unit tests SHALL fake Resend and verify sender config, payload construction,
   error handling, ledger semantics, recipient parsing, and invitation content.
2. Property tests SHALL cover age invariants and recipients parsed from any
   valid separator layout.
3. `pnpm -F @merism/contracts test`, `pnpm -F @merism/contracts typecheck`,
   targeted web tests, `pnpm typecheck`, `pnpm scope-guard`, and
   `pnpm schema:verify` SHALL pass.
4. Operator documentation SHALL explain domain verification, least-privilege
   environment configuration, and the opt-in live-send check.
