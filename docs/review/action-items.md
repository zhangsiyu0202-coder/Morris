# MerismV2 Action Items & Remediation Roadmap

**Date**: 2026-06-27  
**Scope**: Remediation Tasks Derived from Codebase Completeness Review  
**Target Modules**: `apps/web`, `apps/functions`, `apps/agent`, `infra/docker`  

---

## Executive Overview

This document outlines the prioritized action items required to resolve functional gaps, replace temporary mock fixtures, purge architectural anti-patterns, and transition MerismV2 into a fully production-ready state. Action items are classified into three priority tiers:
- **P0 (Critical / High Priority)**: 5 focused, high-impact tasks addressing blocking data flow gaps, RPC wiring, and ghost functions. (Strictly constrained under 15 items).
- **P1 (Important Functional Gaps & Refactoring)**: 4 structural tasks consolidating temporary preview fixtures and refining local developer experience.
- **P2 (Cleanup, Edge Polish, Obsolete Code Removal)**: 3 maintenance tasks ensuring design system polish and dependency hygiene.

---

## Summary Matrix

| ID | Priority | Title | Target Module / Files | Risk Level |
|---|---|---|---|---|
| **ACT-P0-01** | **P0** | Replace Hardcoded Mock Loaders in Study Workbench Data | `apps/web/lib/workspace/data.ts` | **BLOCKING** |
| **ACT-P0-02** | **P0** | Wire RPC Answer Submission in Interview Session Hook | `apps/web/lib/hooks/use-interview-session.ts` | **BLOCKING** |
| **ACT-P0-03** | **P0** | Complete Study Editor UI Migration to Appwrite Native Actions | `apps/web/components/studies/*` | **DEGRADED** |
| **ACT-P0-04** | **P0** | Purge Ghost Function Directories Lacking Source Code | `apps/functions/ingestKnowledgeAsset/`, `searchSurveyKnowledge/` | **DEGRADED** |
| **ACT-P0-05** | **P0** | Wire Assistant Conversation Server Action for Session Switch | `apps/web/components/assistant/conversation.tsx` | **DEGRADED** |
| **ACT-P1-01** | **P1** | Consolidate Temporary Mock Session References | `apps/web/lib/mock-session.ts`, `apps/web/app/page.tsx` | **DEGRADED** |
| **ACT-P1-02** | **P1** | Decouple Transitional Workspace Mock Types | `apps/web/lib/mock/workspace*` | **DEGRADED** |
| **ACT-P1-03** | **P1** | Enhance Local Docker Appwrite Function Executor DX | `infra/docker/docker-compose.yml`, `scripts/` | **EDGE** |
| **ACT-P1-04** | **P1** | Streamline Playwright E2E Spec Naming Alignment | `apps/web/e2e/` | **EDGE** |
| **ACT-P2-01** | **P2** | Perform Routine Dependency Lockfile Housekeeping | `pnpm-lock.yaml` | **EDGE** |
| **ACT-P2-02** | **P2** | Standardize UI Disclosure Row Icon Flush Right Layouts | `apps/web/components/ui/` | **EDGE** |
| **ACT-P2-03** | **P2** | Polish Analysis Report Background Job Notification UX | `apps/web/app/reports/` | **EDGE** |

---

## Detailed Action Items

### Priority P0: Critical & High-Priority Degraded Items

#### ACT-P0-01: Replace Hardcoded Mock Loaders in Study Workbench Data
- **ID**: `ACT-P0-01`
- **Priority**: **P0**
- **Title**: Replace Hardcoded Mock Loaders in Study Workbench Data Query
- **Target Module/Files**: `apps/web/lib/workspace/data.ts` (Lines 40, 53, 66, 100)
- **Impact/Risk Level**: **BLOCKING**
- **Description**: `loadStudyRecruit` unconditionally returns static mock data (`getMockRecruit`). `loadStudyOverview`, `loadStudyResults`, and `loadStudyTranscript` contain hardcoded fallback paths returning `@/lib/mock/workspace` fixtures when queries fail or return empty sets. This prevents real recruitment stats and participant transcripts from displaying in the researcher workbench.
- **Concrete Remediation Steps**:
  1. Refactor `loadStudyRecruit(studyId)` to query Appwrite collection `interview_links` filtered by `surveyId == studyId`. Compute real recruitment statistics (`usedCount`, `maxUses`, active link URLs).
  2. Remove static mock fallbacks from `loadStudyOverview`, `loadStudyResults`, and `loadStudyTranscript`. Return authentic empty-state data structures when Appwrite queries return zero documents.
  3. Update query handlers to throw typed errors or return proper `null` results handled gracefully by UI error boundaries.

---

#### ACT-P0-02: Wire RPC Answer Submission in Interview Session Hook
- **ID**: `ACT-P0-02`
- **Priority**: **P0**
- **Title**: Wire RPC Answer Submission in Interview Session Hook
- **Target Module/Files**: `apps/web/lib/hooks/use-interview-session.ts` (Line 54)
- **Impact/Risk Level**: **BLOCKING**
- **Description**: Line 54 contains `// TODO(interview-portal): replace with merism.submit_answer RPC.`. The client session hook currently increments the question index locally without transmitting participant UI responses to the LiveKit Supervisor agent.
- **Concrete Remediation Steps**:
  1. Import `SUBMIT_ANSWER_RPC_METHOD` and `SubmitInterviewAnswerRpcRequest` schema from `@merism/contracts`.
  2. In `submitAnswer`, replace local index incrementation with `room.performRpc({ method: SUBMIT_ANSWER_RPC_METHOD, payload: JSON.stringify(payload) })`.
  3. Handle RPC response status (`ok: true`) to advance UI state only upon agent acknowledgement.

---

#### ACT-P0-03: Complete Study Editor UI Migration to Appwrite Native Actions
- **ID**: `ACT-P0-03`
- **Priority**: **P0**
- **Title**: Complete Study Editor UI Migration to Appwrite Native Actions
- **Target Module/Files**: `apps/web/components/studies/*`, `apps/web/app/studies/[id]/page.tsx`
- **Impact/Risk Level**: **DEGRADED**
- **Description**: The study editor frontend is in a transitional state following the purge of legacy Drizzle/Postgres persistence files. While backend actions (`lib/actions/survey.ts`) are Appwrite-native, editor UI components require final updates to bind cleanly to Appwrite schemas.
- **Concrete Remediation Steps**:
  1. Update study editor forms in `components/studies/` to use React Hook Form with Zod validation schemas from `@merism/contracts` (`SurveyDraftSchema`).
  2. Bind study creation, section reordering, and question block edits directly to Server Actions in `apps/web/lib/actions/survey.ts`.
  3. Ensure optimistic UI updates correctly reflect Appwrite document mutations.

---

#### ACT-P0-04: Purge Ghost Function Directories Lacking Source Code
- **ID**: `ACT-P0-04`
- **Priority**: **P0**
- **Title**: Purge Ghost Function Directories Lacking Source Code
- **Target Module/Files**: `apps/functions/ingestKnowledgeAsset/`, `apps/functions/searchSurveyKnowledge/`
- **Impact/Risk Level**: **DEGRADED**
- **Description**: These directories contain leftover build artifacts (`dist/`, `node_modules/`) but no TypeScript source files in `src/`. Furthermore, maintaining separate knowledge retrieval functions violates the MerismV2 architecture rule stating research intent must reside on `Survey.flowConfig`.
- **Concrete Remediation Steps**:
  1. Remove `apps/functions/ingestKnowledgeAsset/` and `apps/functions/searchSurveyKnowledge/` completely from the workspace.
  2. Verify that no references to these function names exist in `pnpm-workspace.yaml`, build scripts, or CI configurations.

---

#### ACT-P0-05: Wire Assistant Conversation Server Action for Session Switch
- **ID**: `ACT-P0-05`
- **Priority**: **P0**
- **Title**: Wire Assistant Conversation Server Action for Session Switch
- **Target Module/Files**: `apps/web/components/assistant/conversation.tsx` (Line 249)
- **Impact/Risk Level**: **DEGRADED**
- **Description**: Line 249 contains a TODO regarding switching `conversationId` upon invoking `/new`. The assistant drawer currently resets local messages without persisting or creating a new server conversation session.
- **Concrete Remediation Steps**:
  1. Create server action `createAssistantConversation()` in `apps/web/lib/actions/notebooks.ts` (or dedicated assistant server actions file).
  2. Call `createAssistantConversation()` inside the `/new` command handler in `conversation.tsx` and update URL search params (`?c=[conversationId]`).

---

### Priority P1: Important Functional Gaps & Refactoring

#### ACT-P1-01: Consolidate Temporary Mock Session References
- **ID**: `ACT-P1-01`
- **Priority**: **P1**
- **Title**: Consolidate Temporary Mock Session References
- **Target Module/Files**: `apps/web/lib/mock-session.ts`, `apps/web/app/page.tsx`
- **Impact/Risk Level**: **DEGRADED**
- **Description**: Root landing page preview relies on `MOCK_RUNTIME_QUESTIONS` from `mock-session.ts`.
- **Concrete Remediation Steps**: Consolidate preview hook with live `useLiveInterview` logic under upcoming `interviewee-portal` sub-spec implementation.

#### ACT-P1-02: Decouple Transitional Workspace Mock Types
- **ID**: `ACT-P1-02`
- **Priority**: **P1**
- **Title**: Decouple Transitional Workspace Mock Types
- **Target Module/Files**: `apps/web/lib/mock/workspace.ts`, `apps/web/lib/mock/workspace-billing.ts`
- **Impact/Risk Level**: **DEGRADED**
- **Description**: Components in `components/studies/` and `components/workspace-billing/` import mock type definitions.
- **Concrete Remediation Steps**: Replace mock type imports with official contract types exported by `@merism/contracts`.

#### ACT-P1-03: Enhance Local Docker Appwrite Function Executor DX
- **ID**: `ACT-P1-03`
- **Priority**: **P1**
- **Title**: Enhance Local Docker Appwrite Function Executor DX
- **Target Module/Files**: `infra/docker/docker-compose.yml`, `scripts/stack-up.sh`
- **Impact/Risk Level**: **EDGE**
- **Description**: Local Docker stack relies on in-process dev fallback routes because the function executor container is omitted.
- **Concrete Remediation Steps**: Provide an optional `--with-executor` flag in `stack-up.sh` to spin up `appwrite-executor` for full local Function testing.

#### ACT-P1-04: Streamline Playwright E2E Spec Naming Alignment
- **ID**: `ACT-P1-04`
- **Priority**: **P1**
- **Title**: Streamline Playwright E2E Spec Naming Alignment
- **Target Module/Files**: `apps/web/e2e/`
- **Impact/Risk Level**: **EDGE**
- **Description**: Foundation task 17 referenced `home.spec.ts` which evolved into `workspace-settings.spec.ts` and `interview-pressure.spec.ts`.
- **Concrete Remediation Steps**: Add a lightweight `home.spec.ts` sanity test or update task documentation to explicitly reflect active spec filenames.

---

### Priority P2: Cleanup, Edge Polish, Obsolete Code Removal

#### ACT-P2-01: Perform Routine Dependency Lockfile Housekeeping
- **ID**: `ACT-P2-01`
- **Priority**: **P2**
- **Title**: Perform Routine Dependency Lockfile Housekeeping
- **Target Module/Files**: `pnpm-lock.yaml`
- **Impact/Risk Level**: **EDGE**
- **Description**: Run `pnpm prune` to ensure no orphaned lockfile entries remain.

#### ACT-P2-02: Standardize UI Disclosure Row Icon Flush Right Layouts
- **ID**: `ACT-P2-02`
- **Priority**: **P2**
- **Title**: Standardize UI Disclosure Row Icon Flush Right Layouts
- **Target Module/Files**: `apps/web/components/ui/`
- **Impact/Risk Level**: **EDGE**
- **Description**: Ensure accordion and select triggers strictly follow Design System rule § Disclosure Rows (`flex justify-between w-full`).

#### ACT-P2-03: Polish Analysis Report Background Job Notification UX
- **ID**: `ACT-P2-03`
- **Priority**: **P2**
- **Title**: Polish Analysis Report Background Job Notification UX
- **Target Module/Files**: `apps/web/app/reports/`
- **Impact/Risk Level**: **EDGE**
- **Description**: Enhance real-time progress toast notifications when generating survey analysis rollups.

