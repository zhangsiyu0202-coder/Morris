# User Research Module Discussion Draft

Status: discussion draft
Source reference: local PostHog source under `/home/jia/posthog/products/user_interviews`
Last updated: 2026-06-09

## Purpose

This document captures the agreed direction for a Merism user research module inspired by PostHog's `/user_research` product, while preserving Merism's anonymous interview architecture.

PostHog's module is a useful product reference because it treats user research as a full researcher workflow:

1. Create a research topic.
2. Define the audience and interview questions.
3. Generate public interview links.
4. Track responses.
5. Review each response with transcript and summary.

Merism should copy this product chain, but not copy PostHog's person/profile assumptions.

## PostHog Source Shape

PostHog routes, from `products/user_interviews/manifest.tsx`:

- `/user_research`: topic list
- `/user_research/:id`: interview topic detail
- `/user_research/:topicId/response/:responseId`: interview response detail
- `/user_interviews`: redirect to `/user_research`

PostHog frontend files:

- `products/user_interviews/frontend/UserInterviews.tsx`
- `products/user_interviews/frontend/UserInterview.tsx`
- `products/user_interviews/frontend/UserInterviewResponse.tsx`

PostHog backend model files:

- `products/user_interviews/backend/models.py`
- `products/user_interviews/backend/presentation/views.py`
- `products/user_interviews/mcp/tools.yaml`

PostHog core models:

- `UserInterviewTopic`
  - `topic`
  - `agent_context`
  - `questions`
  - `interviewee_emails`
  - `interviewee_distinct_ids`
  - `invite_subject`
  - `invite_message`
- `IntervieweeContext`
  - `topic`
  - `interviewee_identifier`
  - `agent_context`
- `UserInterview`
  - `topic`
  - `interviewee_identifier`
  - `transcript`
  - `summary`
  - `classifications`
  - `recording_url`
  - `call_metadata`

## Merism Product Position

Merism's equivalent should be:

> A study-level research campaign console for managing anonymous interview links, per-link context, response status, transcripts, recordings, and evidence.

This is not a CRM/person page. It is a researcher workflow around anonymous qualitative evidence.

## Privacy Rule

Merism cannot show PostHog-style person information.

Do not show:

- Person profile
- email
- name
- user properties
- first seen
- distinct ID as an identity profile
- owner/creator audit columns in the researcher-facing table

Allowed display:

- `匿名受访者`
- session short id
- link label
- response status
- interview link
- per-link/interviewee context written by the researcher or AI
- transcript
- summary
- recording/video playback
- video observations

If a user-provided alias exists, treat it as a label, not a verified person identity.

## Proposed Pages

### Study Research Console

Route candidate:

- `/studies/[id]/research`

Equivalent PostHog reference:

- `/user_research/:id`

Purpose:

Manage one study's recruitment links, target contexts, response progress, and testing flow.

Top area:

- Back to study
- Study title
- Research goal / agent context
- Primary actions:
  - create/copy interview link
  - create test interview link
  - export links CSV, optional later

Main cards:

- Response rate
- Awaiting response
- Completed responses
- Questions

Main table:

- Response / anonymous label
- Status
- Link label
- Questions count or section coverage
- Recording available
- Report ready
- Actions

Do not include:

- `Created`
- `Created by`
- owner
- person columns

Right panel:

- Interview link
- Responded / awaiting response status
- Interviewee context
- Topic details
- Latest or selected interview video playback

### Response Detail

Route candidate:

- `/studies/[id]/responses/[sessionId]`

Equivalent PostHog reference:

- `/user_research/:topicId/response/:responseId`

Purpose:

Review one anonymous interview response.

Left column:

- Summary
- Transcript
- bookmarked quote controls
- visual analysis / video observations

Right column:

- Interview link
- Responded / awaiting response status
- Interviewee context
- Topic details
- Interview video playback

Do not include:

- Person card
- person lookup
- email/name/user properties
- first seen

### Topic / Study List

Existing Merism surfaces may already cover this through `/home` and `/studies/[id]`.

If a dedicated list is added later, table columns should be:

- Study title
- Status
- Target sample / completed responses
- Questions
- Latest response status
- Actions

Do not include:

- `Created`
- `Created by`

## Data Model Direction

### InterviewTarget

New collection candidate: `interview_targets`

Purpose:

Merism's anonymous equivalent of PostHog `IntervieweeContext`, tied to a study/link rather than a person.

Fields:

- `$id`
- `surveyId`
- `linkId`
- `targetLabel?`
- `agentContext`
- `status`: `pending | invited | in_progress | responded | expired`
- `sessionId?`
- `createdAt`
- `updatedAt`

Notes:

- `targetLabel` is a researcher-facing label only.
- Do not add email/name/person properties.
- `agentContext` is merged into the LiveKit agent prompt when the interview session starts.

### InterviewSession

Existing collection: `interview_sessions`

Potential additions:

- `targetId?`
- `responseLabel?`

Rules:

- Keep anonymous interviewees accountless.
- Do not attach a researcher-visible `personId`.
- Do not route turn-by-turn state through Appwrite.

### Recording

Existing collection: `recordings`

The response detail page should play recordings through the existing protected route:

- `/api/recordings/[sessionId]/view`

## AI / Tool Direction

PostHog exposes user research through MCP tools in `products/user_interviews/mcp/tools.yaml`.

Relevant PostHog tool concepts:

- create user interview topic
- add interviewee to topic
- create per-interviewee context
- generate public interview links
- export links as CSV
- list topics
- update topic

Merism should expose similar Morris tools, but with anonymous target semantics:

- `createStudyResearchPlan`
- `addInterviewTargetContext`
- `generateInterviewLinks`
- `listStudyResponses`
- `getStudyResponse`
- `createNotebookFromResponses`

Tools must not create or reveal person profiles.

## Implementation Plan

### Phase 1: Contracts and schema

- Add `InterviewTargetSchema` in `packages/contracts`.
- Add `interview_targets` collection in `packages/appwrite-schema`.
- Add owner/study scoping indexes.
- Add contract tests for anonymous-only target shape.

### Phase 2: Token and agent context

- Update `issueLivekitToken` to resolve an optional target by link/session.
- Merge `InterviewTarget.agentContext` into the runtime study context passed to the LiveKit agent.
- Keep the merge server-side; do not expose private target context to anonymous clients beyond what the agent needs.

### Phase 3: Research console page

- Add `/studies/[id]/research`.
- Build response progress cards.
- Build target/session table without created/creator/person columns.
- Add interview link panel.
- Add selected/latest video preview if a recording exists.

### Phase 4: Response detail page

- Add `/studies/[id]/responses/[sessionId]`.
- Reuse transcript query and recording query code.
- Reuse or adapt `TranscriptView`.
- Add right panel with:
  - interview link
  - response status
  - interviewee context
  - topic details
  - video playback
- Remove any person lookup path.

### Phase 5: Morris tools

- Add anonymous study research tools.
- Let Morris draft study targets and contexts.
- Let Morris create a notebook from selected responses after notebook support lands.

### Phase 6: Notebook integration

- Add actions from response detail:
  - send transcript quote to notebook
  - send video timestamp to notebook
  - send visual observation to notebook
- This should write structured notebook nodes, not plain text only.

## Open Questions

- Should `InterviewTarget` be created per link, per target row, or per generated single-use link?
- Should reusable links have target context, or should target context require single-use links?
- Should response detail replace the current `/studies/[id]/results/[sessionId]` page, or should the old route redirect?
- Should `targetLabel` be visible to the interviewee, or researcher-only?
- What is the first-class term in UI: response, interview, session, or participant?

## Non-goals

- No teams or organizations.
- No multi-user collaboration.
- No public sharing/comments.
- No billing, quota, seats, plans, or usage metering.
- No person/profile page.
- No direct anonymous Appwrite writes.
- No PostHog-style `interviewee_emails` as a stored identity field in the response detail.

