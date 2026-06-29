# ADR 0009: Adopt AI SDK 6 native HITL + pruneMessages for Morris

Date: 2026-06-29

## Status

**Accepted** (2026-06-29). Approved by the product owner (Jia).

Supersedes the relevant sections of sub-spec
`.kiro/specs/morris-agent-hardening/` — specifically requirements **R6**
(对话压缩 `planCompaction` / `applyCompaction` 纯函数) and **R8** (危险操作
Approval 框架 `ApprovalEnvelope` + `withApprovalGuard` + `/api/assistant/
confirm` 二次请求模型). The other six items in that sub-spec (R1
ToolResultEnvelope, R2 PageContext, R3 prompt 结构化, R4 LLM 错误分类, R5 工具
错误协议, R7 TodoWrite) are NOT touched by this ADR and remain in force.

The `morris-agent-hardening` design/requirements/tasks documents stay as
historical record per the AGENTS.md "specs are append-mostly" rule; this
ADR is the source of truth for the current implementation of R6 + R8.

## Context

The `morris-agent-hardening` sub-spec (accepted earlier this year) added
two pieces of self-written infrastructure to Morris:

**R6 — Conversation compaction (`compaction.ts`)**
A `planCompaction` / `applyCompaction` two-step pure-function pair plus
`summarizeMessages`, a DeepSeek-backed LLM summarizer. When the message
window exceeded a token budget, the route handler dropped older messages
and inserted a system-role summary message in their place. Failure
fallback inserted a placeholder "(早期对话已省略)" line. Borrowed shape
from PostHog `ee/hogai/core/agent_modes/compaction_manager.py`.

**R8 — Tool approval (`approval.ts` + `/api/assistant/confirm`)**
A `withApprovalGuard` wrapper turned a destructive tool's `execute` into
"return a `pending_approval` envelope if no approval token". A
`hasPendingApproval` `stopWhen` halted the agent loop. The frontend
rendered an `ApprovalCard`, POSTed the user's decision to
`/api/assistant/confirm`, which bypassed the LLM and called the real
write action (e.g. `createSurveyFromDraft`) directly. Borrowed shape
from PostHog `_handle_dangerous_operation` in `ee/hogai`. The sub-spec
comment explicitly noted this design existed because
"ToolLoopAgent 没有'图暂停'概念" — i.e. AI SDK lacked native HITL
at the time the sub-spec was written.

Both decisions were sound for their moment but have since been overtaken
by AI SDK 6.0.x shipping first-class support:

- `tool({ needsApproval })` — declarative per-tool gate, accepts
  `boolean` or `async (input, { toolCallId, messages, experimental_context }) => boolean`.
- `useChat().addToolApprovalResponse({ id, approved, reason? })` — client-side
  decision write-back.
- `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
  — automatic continuation after every approval in the last step has been
  responded to.
- `pruneMessages({ messages, reasoning, toolCalls, emptyMessages })` —
  structural message-window prune that drops reasoning parts and old
  tool-call/result pairs without invoking an LLM.

Verified present in the installed `ai@6.0.196` package by grepping
`dist/index.js.map` for `is-approval-needed.ts`, `prune-messages.ts`,
`collect-tool-approvals.ts`, `tool-call-not-found-for-approval-error.ts`,
and `last-assistant-message-is-complete-with-approval-responses.ts` —
all present. The features documented in the AI SDK 7 docs are also
available in the 6.0.x line we use.

Sources consulted before this ADR:

- https://ai-sdk.dev/cookbook/next/human-in-the-loop
- https://ai-sdk.dev/cookbook/guides/agent-context-compaction
- https://ai-sdk.dev/docs/reference/ai-sdk-ui/prune-messages
- https://ai-sdk.dev/docs/agents/tool-approvals

## Decision

### R6 supersede — compaction goes to `prepareStep::pruneMessages`

`compaction.ts` is removed (≈190 lines + 1 unit-test file + 1
property-test file). Replace with a 5-line block inside
`apps/web/lib/assistant/agent.ts::prepareStep` that calls AI SDK's
`pruneMessages` when the model-message window exceeds
`COMPACT_AFTER_TOKENS` (12_000, the same number that was previously the
LLM-summarizer trigger):

```ts
if (estimateModelMessageTokens(messages) > COMPACT_AFTER_TOKENS) {
  patch.messages = pruneMessages({
    messages,
    reasoning: "all",
    toolCalls: "before-last-3-messages",
    emptyMessages: "remove",
  });
}
```

Trade-offs accepted:

1. **No more LLM summary** — older tool calls / reasoning parts are
   dropped, not summarized. The structural prune is strictly cheaper
   (zero LLM calls) but discards information that a good summary would
   have kept. For Morris's interactive style (mostly ≤ 8 steps,
   `stopWhen: stepCountIs(8)`), the trigger fires rarely; when it does,
   keeping the last 3 messages' tool-call evidence is sufficient context
   for the model.
2. **No `morris.compaction.summarize` observability event** — the
   removed LLM call no longer generates an observability sink event.
   The Wave B registration in `.kiro/steering/errors-and-observability.md`
   is updated to remove that row. The shape of LLM-call observability
   itself (the `LLMCallEventSchema` + sink rule) is unchanged.

### R8 supersede — approval goes to `tool({ needsApproval })`

`approval.ts`, `/api/assistant/confirm/`, `ApprovalEnvelope`, `withApprovalGuard`,
`hasPendingApproval` stopWhen, `isPendingApprovalArtifact`, and the
existing `ApprovalCard` are removed (≈300 lines + 2 test files).
Each destructive tool now declares its gate inline:

```ts
return {
  metadata,
  spec: tool({
    description,
    inputSchema,
    needsApproval: async () => ctx.ownerUserId !== null,
    execute: async (input) => { /* the actual side effect */ },
  }),
};
```

`addToolApprovalResponse` + `sendAutomaticallyWhen:
lastAssistantMessageIsCompleteWithApprovalResponses` on the `useChat`
client wire the approve / deny flow. The new `ApprovalCard` is a
callback-driven component (`onApprove`, `onDeny(reason?)`) that the
parent `Conversation` component invokes; no `fetch` to a confirm
endpoint, no proposalId, no payload echo. The tool's `execute()` runs
after approval (with the LLM in the loop) instead of being bypassed by
a side-channel POST.

The two tools affected today:

- **`createStudyDraft`** — `needsApproval: async () => signedIn` so
  anonymous users still see preview-only without an approval prompt.
- **`manageMemories`** — `needsApproval: async ({ action }) => action === "delete"`
  so per-action approval triggers only on the destructive `delete`
  branch. The earlier compromise (entire tool `destructive: false` because
  the wrapping framework couldn't express per-action gates) is no
  longer necessary now that `needsApproval` is a function of `input`.

Future destructive tools follow the same pattern; no per-spec opt-in.

## Consequences

**Positive**

- ≈500 lines of self-written approval / compaction code removed.
- One DeepSeek call per compaction trigger removed (cost + latency win,
  variable in size).
- Approval flow is now end-to-end in the LLM message stream — the model
  sees the approval result and can comment on it, rather than the
  user's decision arriving via a side-channel POST that bypassed the
  LLM entirely.
- `manageMemories.delete` per-action approval becomes free; previously
  needed a Wave 2 follow-up sub-spec (see `apps/web/AGENTS.md` long-term
  memory section §6).
- AI SDK 6 native types replace our ad-hoc envelopes — the part shapes
  (`approval-requested`, `output-available`, `output-denied`) are
  documented and stable per the AI SDK release line.

**Negative**

- Older messages lose their reasoning + tool-call detail (replaced by
  structural prune, not summary). Mitigated by the trigger threshold
  (12k tokens, well above typical Morris use) and the
  `before-last-3-messages` retention window.
- `tools.test.ts` for `withApprovalGuard` and `compaction.test.ts` for
  `planCompaction` / `applyCompaction` are gone; replaced with smaller
  tests on `needsApproval` behaviour (per-tool) and on the agent's
  `prepareStep` (already covered indirectly by existing agent integration
  tests).
- The `morris-agent-hardening` sub-spec is now partially stale: R6 + R8
  description doesn't match the current code. The spec remains in the
  repo as a historical record per the AGENTS.md "specs are append-mostly"
  rule; this ADR is the entry point for "what's the current state of R6 +
  R8". A reader landing on the spec is expected to follow the ADR link
  in `errors-and-observability.md` and `AGENTS.md` to here.

## Alternatives rejected

- **Keep `compaction.ts` LLM summarizer behind the new `prepareStep`
  pattern** — wraps the existing summarizer in `prepareStep`, replacing
  the trigger only. Rejected: the cost of the per-compaction LLM call is
  not justified for Morris's typical short-conversation pattern; the
  summary quality has been observed to be inconsistent (truncations,
  occasional irrelevant content); pruneMessages with the
  `before-last-3-messages` setting preserves the recent evidence that
  matters most.
- **Keep `approval.ts` wrapping but also opt into `needsApproval` for
  observability** — runs both gates in parallel. Rejected: two competing
  approval mechanisms is the worst of both worlds; the ad-hoc envelope
  shape is brittle (the LLM doesn't see the approval result).
- **Wait for AI SDK 7** — AI SDK 7 docs we consulted state native
  approval and `pruneMessages` are also in 7. But the features are
  present in 6.0.196 already; upgrade is out of scope for this ADR.

## Implementation reference

Files removed (this PR):

- `apps/web/lib/assistant/approval.ts`
- `apps/web/lib/assistant/compaction.ts`
- `apps/web/lib/assistant/__tests__/approval.test.ts`
- `apps/web/lib/assistant/__tests__/compaction.test.ts`
- `apps/web/app/api/assistant/confirm/route.ts`
- `apps/web/app/api/assistant/__tests__/confirm-route.test.ts`
- `tests/properties/morris-agent-hardening/approval-stop.test.ts`
- `tests/properties/morris-agent-hardening/compaction-monotone.test.ts`

Files modified:

- `apps/web/lib/assistant/agent.ts` — `pruneMessages` in `prepareStep`;
  `hasPendingApproval` removed from `stopWhen`.
- `apps/web/lib/assistant/tools.ts` — `wrapWithApproval` removed;
  builders return `spec` directly.
- `apps/web/lib/assistant/tools/create-study-draft.ts` —
  `needsApproval: async () => signedIn`; `approvalToken` removed from
  `InputSchema`.
- `apps/web/lib/assistant/tools/manage-memories.ts` —
  `needsApproval: async ({ action }) => action === "delete"`;
  metadata.annotations.destructive remains `false` at the tool level (the
  per-action gate handles it), with a comment pointing here.
- `apps/web/components/assistant/conversation.tsx` —
  `addToolApprovalResponse` + `sendAutomaticallyWhen` wired;
  `approval-requested` and `output-denied` parts rendered.
- `apps/web/components/assistant/approval-card.tsx` — callback-driven
  rewrite.
- `apps/web/components/assistant/tool-results.tsx` —
  `isPendingApprovalArtifact` branch removed.
- `.kiro/steering/errors-and-observability.md` —
  `morris.compaction.summarize` registration removed.
- `apps/web/AGENTS.md` — tool metadata section and llm-observability
  section updated to reflect the new shape.
- `scripts/scope-guard.ts` — six compaction-related whitelist tokens
  removed (no longer needed once `compaction.ts` is gone).

Test coverage:

- `apps/web/lib/assistant/__tests__/create-study-draft.test.ts` —
  rewritten to test `needsApproval` behaviour and direct-execute
  persistence.
- `apps/web/lib/assistant/__tests__/manage-memories.test.ts` (new) —
  tests `needsApproval` returns true only for `action === "delete"`.

Sub-spec dependencies updated:

- `.kiro/specs/morris-agent-hardening/{requirements,design,tasks}.md`
  — historical, not edited. This ADR is the authority for R6 + R8.
- `.kiro/specs/morris-memory/design.md §10.6` — "destructive 折中"
  language is now historical; the new design supersedes it via this ADR
  (manageMemories.delete per-action approval is implemented).
