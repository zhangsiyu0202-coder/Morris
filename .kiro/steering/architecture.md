---
inclusion: always
---

# Architecture (binding)

Module boundaries, Function shape, agent realtime↔persistence boundary, concurrency contract, and cross-module change order. This file is the operational rulebook for "where does this code live and what is it allowed to import". Read together with `contracts.md`, `errors-and-observability.md`, `scope.md`, and `pre-implementation.md`.

## Module map

| Module | Path | Owns | MUST NOT |
|---|---|---|---|
| Contracts | `packages/contracts` | zod schemas + TS types for every cross-module shape | runtime logic, I/O, network calls |
| Contracts mirror | `apps/agent/agent/contracts.py` | pydantic mirror of agent-needed contracts | fields not in TS; snake_case rename |
| Observability | `packages/observability` | `createLogger`, `withRetry`, `withErrorBoundary`, `maskSecret`, `traceId` | business logic, provider calls |
| Appwrite schema | `packages/appwrite-schema` | declarative collections + permissions + buckets, `apply` / `verify` | runtime data writes |
| Functions | `apps/functions/<name>` | request → response surfaces; pure core in `handler.ts`, SDK wrapper in `main.ts` | shared state across invocations; SDK imports in `handler.ts` |
| Agent | `apps/agent` | LiveKit Supervisor / TaskGroup / AgentTask realtime workflow | Appwrite writes for turn-by-turn state; LangGraph control flow |
| Web | `apps/web` | Next.js: researcher UI, Morris, interviewee surfaces, analysis surfaces | domain logic that belongs in a Function; client-side writes for anonymous interviewees |

Cross-module data flows ONLY through `packages/contracts`. Cross-module side effects flow ONLY through Functions or the agent. There is no shared mutable singleton anywhere.

## Function shape (binding)

Reference implementation: `apps/functions/issueLivekitToken/`. Every new Function MUST follow it.

- `src/handler.ts` — pure core. Takes `rawInput: unknown` and a typed `Deps` interface. Returns `{status, body}`. Fully unit/property testable with in-memory deps.
- `src/main.ts` — SDK wrapper. Reads env, instantiates Appwrite/LiveKit SDKs, builds `Deps`, calls the pure core, maps the result to the Appwrite Function response.
- `src/deps.ts` — `*Deps` interface and `createRealDeps()`. One typed function per external effect. No broad service objects.

Hard rules:
- `handler.ts` MUST NOT import: `node-appwrite`, `appwrite`, `livekit-server-sdk`, `process`, `fs`, or any other SDK / runtime module.
- `main.ts` MUST NOT contain business logic (no branching on link state, no permission checks, no error-code derivation).
- All input parsing MUST happen at the boundary via the request schema from `@merism/contracts`. Reject malformed input with `400 invalid_input` before any side effect.
- Concurrency safety MUST come from deterministic ids (e.g. `s_${linkId}_${k}`) plus Appwrite unique-id 409 acting as CAS. NEVER in-memory locks / timestamps / read-modify-write.
- Rollback on partial failure MUST be best-effort (`.catch(() => {})`) with an explicit comment, and MUST NOT throw past the boundary.
- Function execution permissions MUST be set explicitly in the Function declaration. Anonymous interviewees never get direct collection write — Functions are the only path.
- `handler.ts` MUST NOT see raw secret strings. Secrets stay in `main.ts` env reading.

Enforcement (run from repo root):

```bash
# handler.ts must not import any SDK
grep -RIn 'from "node-appwrite"\|from "appwrite"\|from "livekit-server-sdk"' apps/functions/*/src/handler.ts && echo "VIOLATION: SDK import in handler.ts"
# main.ts must not import @merism/contracts request schemas for the purpose of validation logic
# (request parsing happens inside handler; main only forwards rawInput)
```

## Agent realtime ↔ persistence boundary (binding)

Per ADR-0001 the realtime interview is **LiveKit Supervisor + ordered TaskGroups + focused AgentTasks**. No LangGraph, no custom state machines, no second controller framework.

Stays inside the LiveKit room (room metadata + participant attributes + RPC):
- Turn-by-turn conversation state
- Partial transcript
- Audio buffers
- Ephemeral agent variables
- Computed "next question" / "current section" cursor (`InterviewWorkflowState`)

Crosses into Appwrite (one-way, append-only):
- Finalized transcript
- Final recording file
- Finalized answer payload (`collectedAnswers`)
- AnalysisReport (after `analyzeSession` completes)

NEVER:
- Round-trip "next question" through Appwrite
- Persist partial / streaming transcript per turn
- Share mutable state across sessions on the agent worker process
- Top-level import of livekit modules in `agent/interview/` — they MUST stay lazy so `pnpm test:py` runs without `--extra realtime`

Pure workflow logic (state transitions, advancement, completion check) lives in `apps/agent/agent/interview/workflow.py` and is side-effect free. Side effects (livekit calls, Appwrite writes, attribute publish) live in `engine.py` / `supervisor.py` and delegate every state transition to `workflow.py`.

## Concurrency contract (binding)

For any operation that can race (link claim, session create, slot reservation, recording finalize):

1. Compute a deterministic candidate id from inputs (`s_${linkId}_${slotIndex}`).
2. Attempt `createDocument` with that id; on 409 treat the slot as taken and try the next one.
3. NEVER use a counter-based read-modify-write as the gate (the unique id is the gate; counters are hints).
4. Bound the loop by an explicit ceiling (`effectiveMax`); on exhaustion return the proper error code (`link_exhausted`).

In-memory locks, mutexes, atomic counters, or "time-window" deduplication are NOT allowed at this layer. If a future requirement seems to need them, open an ADR.

## Cross-module change order (binding)

Changing any cross-module shape (entity field, RPC payload, room metadata) MUST be done in this order, **in a single PR**:

1. Update zod schema in `packages/contracts/src/{entities,api,state,notebook}.ts`. Add `superRefine` for any new invariant.
2. If the agent uses the shape: mirror to `apps/agent/agent/contracts.py` with identical field names.
3. Update consumers in dependency order: contracts → functions → agent → web.
4. Update / add tests at the same time (property tests for the new invariant, unit tests for new behaviour).
5. If the schema changes the database surface: update `packages/appwrite-schema/src/schema.ts` AND run `pnpm schema:verify` against local stack.

NEVER:
- Merge a contract change ahead of consumer updates.
- Skip the Python mirror because "the agent doesn't use it yet" (it will, and the next PR will be ambiguous).
- Add a new field to a Function response without first updating the schema.

## Globally forbidden

- A second LLM provider beyond DeepSeek (without ADR).
- A second ASR/TTS provider beyond Qwen (without ADR).
- LangGraph as the realtime interview controller.
- Direct Appwrite collection writes from anonymous (interviewee) clients — Functions only.
- Module-level mutable singletons that survive across requests / sessions.
- TypeScript `interface` or `type` for cross-module domain shapes outside `packages/contracts` (UI-local props are exempt).
- New icon library beyond `lucide-react` + Figma payload SVGs (per `design-system.md`).
- `font-['<Family>']` direct family classes (use semantic `font-*` roles per `design-system.md`).

## Where new things go

| New thing | Goes in |
|---|---|
| Cross-module data shape | `packages/contracts/src/{entities,api,state,notebook}.ts` |
| Reusable observability helper | `packages/observability/src/` |
| Appwrite collection / index / bucket declaration | `packages/appwrite-schema/src/schema.ts` |
| Server-side request/response surface | `apps/functions/<name>/` (pure core + SDK wrapper) |
| Realtime interview behaviour | `apps/agent/agent/interview/{workflow,supervisor,engine}.py` |
| Researcher UI scene | `apps/web/app/<route>/` + `apps/web/components/<feature>/` |
| LLM 调用观测 (任何新加的 generateText/streamText) | 走 `packages/observability::withLLMCall` (调用点可见) 或 `wrapLanguageModel({middleware: llmObservabilityMiddleware(...)})` (调用点不可见). scope 命名规范 `morris.*` / `function.*` / `action.*`. 参 `.kiro/specs/morris-llm-observability/` |
| Morris 长期记忆 (跨对话 user-级事实 + manageMemories 工具) | `apps/web/lib/memories/{server,actions,embed}.ts` + `apps/web/lib/assistant/tools/manage-memories.ts`. embedding 复用 Qwen text-embedding-v3 (与 Notebook 同), cosine 检索 + fulltext fallback. 不引入 LangGraph onboarding flow. 参 `.kiro/specs/morris-memory/` |
| Morris 对话持久化 (Conversation 字段 / Server Action / 历史 UI) | `apps/web/lib/conversations/{server,actions,title}.ts` + `apps/web/components/assistant/{conversation-history,history-preview,assistant-scene-shell,use-current-conversation-id}.tsx`. 不引入 LangGraph checkpoint, useChat 序列化 UIMessage[] 整批存. 参 `.kiro/specs/morris-conversation-persistence/` |
| Page assistant tool | `apps/web/lib/assistant/tools/` (同时填齐 `metadata: ToolMetadata` 并注册到 `buildAssistantToolMetadata` + 同步 `tool-enrich-urls.ts`; 参考 `.kiro/specs/morris-tool-metadata/`; 仍须按 `scope.md` 论证为何归 Morris 而非 Function) |
| Cross-cutting design decision | `docs/adr/<NNNN>-<slug>.md` |
