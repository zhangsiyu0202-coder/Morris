# Tasks: recruitment-email

## Wave A: contracts and schema

- [ ] Add `RecruitmentCriteriaSchema`, Survey mapping, invariant and contract
  property tests.
- [ ] Add typed `surveys` attributes and verify the live schema diff.

## Wave B: provider migration

- [ ] Add the official `resend` SDK and remove Nodemailer dependencies.
- [ ] Replace SMTP configuration, transport verification, and mail send tests
  with Resend configuration and fake-client tests while retaining the delivery
  ledger.
- [ ] Update environment and business-email operator documentation.

## Wave C: recruitment invitation

- [ ] Implement the pure invitation renderer and its injection/content tests.
- [ ] Add author-gated criteria persistence and invitation sending action.
- [ ] Extend the recruitment page with criteria editing, active-link selection,
  manual recipient entry, and explicit send-result feedback.

## Wave D: verification

- [ ] Run contract, web, workspace, schema, and scope validation.
- [ ] Run an opt-in real Resend delivery only when a verified sender domain and
  a local sending key are supplied.
