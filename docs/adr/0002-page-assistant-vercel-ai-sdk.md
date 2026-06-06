# ADR 0002: Page Assistant on Vercel AI SDK 6 (replaces CopilotKit)

## Status

Accepted (2026-06-06).

## Context

The foundation-setup baseline originally chose **CopilotKit** as the page-side
assistant framework for the researcher web app. Its `useCopilotAction` model
and pre-built sidebar/standalone UIs were attractive when the spec was first
written.

Two things changed since:

1. **The Vercel AI SDK shipped v6**, which adds first-class agent primitives
   (`ToolLoopAgent`, `prepareStep`, `stopWhen`, `tool({...})`) and a streaming
   transport (`createAgentUIStreamResponse` + `@ai-sdk/react useChat`).
   This covers the same surface CopilotKit provided — tool calling, multi-step
   loops, streaming UI — without an extra runtime layer.
2. **The actual codebase** (researcher assistant under `apps/web/`) was built
   directly on AI SDK 6 in a v0-generated branch. CopilotKit packages still
   appear in `pnpm-lock.yaml` from earlier scaffolding but are **not imported**
   by `apps/web/package.json` or any application code. The chosen stack is
   already AI SDK 6 in practice.

Continuing to claim CopilotKit in the architecture spec while shipping AI SDK 6
in code creates documentation drift and forces future module authors to learn
two stacks.

## Decision

Adopt **Vercel AI SDK 6** as the only page-assistant framework for the
researcher web app, and remove CopilotKit from the architecture spec.

The page assistant ("Morris") is implemented as:

- **Agent**: `ToolLoopAgent` instance in `apps/web/lib/assistant/agent.ts`,
  model = DeepSeek (`deepseek-chat`), with a downgrade path to
  `deepseek-reasoner` once tools have errored or after step 5 (tools are
  disabled at that point so the model focuses on explanation).
- **Loop control**: `stopWhen: [stepCountIs(8), budgetExceeded(24000 tokens)]`,
  `maxRetries: 2`. Long conversations are trimmed in `prepareStep` to the most
  recent 16 messages.
- **Tools** (`apps/web/lib/assistant/tools.ts`):
  `createStudyDraft / searchInterviewData / analyzeData / listStudies`. Each
  tool wraps internal failures into a structured `{ error: true, message }`
  payload so the UI can render a failure card without crashing the stream.
  Data source is currently mocked in `lib/agent-data.ts` and will be wired to
  real persistence when the editor and report subspecs land.
- **API**: `apps/web/app/api/assistant/route.ts` runs on Node runtime,
  uses `createAgentUIStreamResponse({ agent: morrisAgent, uiMessages })`,
  with `onError` translating provider errors into user-facing Chinese strings
  (auth / rate-limit / timeout / generic).
- **UI**: `apps/web/components/assistant/{assistant-dock,conversation,
  markdown,tool-results}.tsx` consumes the stream via `@ai-sdk/react`'s
  `useChat` + `DefaultChatTransport`. The dock is the in-page sidebar; the
  full-screen surface is `apps/web/app/assistant/page.tsx`.

The product term across docs and UI is "**Page Assistant**" (中文："页面助手")
or its product name "**Morris**". `useCopilotAction`, `CopilotSidebar`,
`@copilotkit/runtime` and related symbols must not be referenced in
specifications or new code.

## Consequences

**Spec updates** (this ADR's companion edits):

- `AGENTS.md`: page-assistant rule and "mature ecosystem patterns" list now
  point at AI SDK 6, not CopilotKit.
- `README.md`: architecture summary and `survey-editor` sub-spec scope.
- `.kiro/specs/foundation-setup/requirements.md`: Requirement 4.5.
- `.kiro/specs/foundation-setup/tasks.md`: Task 9.
- `.kiro/specs/foundation-setup/design.md`: §1, §1.2, §2 glossary, §3.1
  topology diagram, §3.2 component table, §5.1 researcher-creates-survey flow,
  §6.4 page-assistant tool contract, §technology-decision table (D-04 / D-08 /
  D-09 / D-12), correctness Property P-SEC-04, and the survey-editor sub-spec
  scope row.

**Code changes already in `master`**: page assistant fully implemented on AI
SDK 6 — no migration work required by this ADR.

**Cleanup items** (separate workstream, not blocked by this ADR):

- Remove `@copilotkit/*` packages from `pnpm-lock.yaml` on the next dependency
  refresh. They are not in any `package.json` and not imported.
- The `survey-editor` sub-spec (still un-written) should reference this ADR
  instead of CopilotKit when it specifies how the researcher edits surveys
  with assistant help.

**Limits**:

- `ToolLoopAgent` does not provide a UI shell out of the box. We own the chat
  surface (already implemented in `apps/web/components/assistant/`). This is
  intentional: it lets us match the Mauve Quiet design system without fighting
  a third-party theme.
- `useCopilotReadable` (auto-attached page state) has no exact AI SDK 6
  counterpart. When the editor needs assistant access to the current draft,
  the editor will pass relevant state explicitly through tool inputs or
  through the request body — not through a global readable channel. This is a
  mild verbosity tax in exchange for explicit data flow.

## References

- AI SDK 6 agents: https://sdk.vercel.ai/docs/ai-sdk-core/agents
- AI SDK 6 `tool()`: https://sdk.vercel.ai/docs/reference/ai-sdk-core/tool
- AI SDK UI streaming: https://sdk.vercel.ai/docs/ai-sdk-ui
- Implementation: `apps/web/lib/assistant/agent.ts`,
  `apps/web/lib/assistant/tools.ts`,
  `apps/web/app/api/assistant/route.ts`,
  `apps/web/components/assistant/*.tsx`.
- Supersedes CopilotKit choice in `foundation-setup/design.md` decision D-12.
