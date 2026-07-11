# apps/functions

Per-module supplement covering all Appwrite Functions. Read root `AGENTS.md`, `.kiro/steering/architecture.md` (Function shape), `.kiro/steering/errors-and-observability.md`, and `.kiro/steering/contracts.md` first. This file holds ONLY rules specific to this app.

## Reference implementation

`apps/functions/issueLivekitToken/` is the canonical Function shape. Every new Function MUST mirror its layout:

```
<name>/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    handler.ts   # pure core; takes rawInput + Deps; returns {status, body}
    main.ts      # SDK wrapper; entrypoint exported as default
    deps.ts      # Deps interface + createRealDeps()
  tests/
    handler.test.ts
    properties.test.ts   # property-based: permission, concurrency, secret leakage, rollback
```

## Current Functions

| Function | Purpose |
|---|---|
| `issueLivekitToken/` | Validate `InterviewLink`, claim a session slot via deterministic `$id`, sign LiveKit JWT, embed runtime study metadata in room. Reference for Function shape. |
| `analyzeSession/` | Generate `AnalysisReport` (`scope=session`) with DeepSeek thematic coding + citations. |
| `analyzeSurvey/` | Roll up session reports into a survey-scope `AnalysisReport`. Triggered by `analyzeSession` per ADR-0003 D1+D4. |
| `searchAcrossNotebooks/` | Researcher Notebook full-text / vector search. |

## Module-specific rules (binding)

- Every Function MUST be wrapped at the entry by `withErrorBoundary(scope, handler)` from `@merism/observability`. Uncaught throws turn into `{ ok: false, status: 500, error: "internal_error", traceId }`.
- The default export of `src/main.ts` is the Appwrite Functions runtime entry. It MUST do exactly: read env, build `Deps`, call the pure core, map result to `res.json(body, status)`. No business logic.
- Request parsing happens once, inside the pure core, via the request schema from `@merism/contracts`. `main.ts` only forwards `req.bodyJson` (or `req.bodyRaw` parsed as JSON if `bodyJson` is absent).
- The `Deps` interface enumerates every external effect the handler needs as a single typed function (`findLink`, `createSession`, `signToken`, ...). No broad service objects, no `db: Databases`. This is what makes property tests with in-memory deps possible.
- Concurrency safety MUST come from deterministic ids + Appwrite 409 (CAS). See `issueLivekitToken/src/handler.ts` for the canonical claim loop. NEVER `usedCount`-based read-modify-write.
- Rollback after partial failure MUST follow reverse order of side effects, each step wrapped with `.catch(() => {})` and a comment explaining why silent continuation is correct. The response is already a 5xx — the rollback MUST NOT throw past the boundary.
- A Function MUST NOT log raw secrets or raw provider prompts at `info`. Use `maskSecret` for tokens. Provider prompts go to `debug` only, gated by `MERISM_DEBUG_PROVIDERS=1`.
- Each Function declares execution permissions explicitly in `packages/appwrite-schema/src/schema.ts`. Anonymous interviewees ONLY get `execute` on Functions designed for them; no direct collection write.

## Cross-Function shared code

There is no shared library between Functions today. If a helper is needed by two Functions:
1. First check whether it belongs in `packages/contracts` (a pure schema/predicate), `packages/observability` (logging/retry/error), or `packages/appwrite-schema` (collection helper).
2. If none of the above and it is genuinely Function-only, add it to `packages/observability` under `src/functions/` with a clear name. Do NOT introduce an `apps/functions/_shared/` folder.

## Cross-module change triggers

| If you change | You MUST also update |
|---|---|
| Request / response schema | `packages/contracts/src/api.ts` first, then this Function's parsing call, then any web/agent consumer |
| Permission requirement (who may execute) | `packages/appwrite-schema/src/schema.ts` Function declaration AND the property test verifying anonymous role cannot bypass |
| Side-effect order | Rollback path MUST be re-verified with a same-PR property test |
| Provider call (LLM/STT/TTS) | The corresponding adapter in `apps/agent/agent/providers/` or `apps/web/lib/assistant/providers/` and its retry classification |

## Anti-patterns specific to this app

- Importing `node-appwrite` / `livekit-server-sdk` / `appwrite` inside `handler.ts`. The pure core MUST be SDK-free.
- A Function that branches on `process.env` inside `handler.ts`. Env reading happens in `main.ts` only.
- Skipping the `Deps` interface and "just calling the SDK directly because it's simpler". The whole point of the layout is testability.
- Returning a 5xx body manually with a stack-included message. 5xx ALWAYS goes through `withErrorBoundary` and returns `{ error: "internal_error", traceId }`.
- Cross-Function imports (`import x from "../otherFunction/src/handler"`). Functions are deployed independently.

## Enforcement (per-module)

```bash
# Per-Function typecheck
pnpm -F <function-package-name> typecheck
# Property tests (handler-level)
pnpm -F <function-package-name> test

# Workspace-wide property tests (permission matrix, secret leakage)
pnpm test:properties

# Confirm no SDK leak into handlers
grep -RIn 'from "node-appwrite"\|from "appwrite"\|from "livekit-server-sdk"' apps/functions/*/src/handler.ts && echo "VIOLATION"
```

A new Function without the four files above and without same-PR property tests is not ready to merge.

## Known foot-guns

Concrete pitfalls observed in this codebase. Add a new entry here every time a non-trivial bug is fixed in this module.

### `usedCount`-based read-modify-write is a race condition, deterministic id is the gate

Tempting pattern when implementing a new "claim a slot" Function: read `link.usedCount`, increment it, write back, then create the session. Under concurrency, two requests can read the same `usedCount`, both increment to `n+1`, both create different session ids — `usedCount` ends up at `n+1` while two sessions exist. The single-use link constraint is silently violated.

**Rule** (see `issueLivekitToken/src/handler.ts` for the canonical loop):

1. Compute deterministic candidate id `s_${linkId}_${k}`.
2. `createDocument` with that id; on 409 try the next slot.
3. Update `usedCount` AFTER a successful claim. The counter is a hint, not the gate. The unique `$id` is the gate.

A property test exercising N concurrent claims is part of every "claim slot" Function's first PR (per `testing.md` mandatory scenarios).

### Rollback ordering matters: room → session → counter

When `signToken` or `getSurveyMeta` fails after `createSession` and `createRoom` succeeded, the rollback MUST run in reverse order of side effects — `deleteRoom`, `deleteSession`, `setUsedCount(previousUsedCount)`. Reverse order matters: if `deleteSession` is attempted first and it fails, the orphan room would persist with no document linking it back.

Each rollback step is wrapped in `.catch(() => {})` because the response is already a 5xx — the cleanup must not throw past `withErrorBoundary`.

The `setUsedCount(previousUsedCount)` step is **last-write-wins** against any concurrent successful claim. This is a deliberate trade-off documented in the rollback comment: functional correctness comes from the deterministic id (never duplicated), the counter rollback is best-effort cosmetic. An atomic compare-and-set would close this gap and is filed as a follow-up.

### Importing `node-appwrite` in `handler.ts` makes the entire test suite useless

The pure core lives in `handler.ts` and is supposed to be testable with in-memory deps. Importing `node-appwrite` (or any SDK) at the top of `handler.ts` pulls in the SDK at test time, bringing in network probes and config that explode without env vars set. The tests still "pass" if the import itself doesn't crash, but they no longer exercise the pure-core contract — they exercise the SDK wrapper accidentally.

**Detection**: `grep -RIn 'from "node-appwrite"\|from "appwrite"\|from "livekit-server-sdk"' apps/functions/*/src/handler.ts` should always be empty. Any hit is a defect.

### Logging the issued token at full length

`maskSecret(token)` exists for a reason. A common slip is writing `logger.info("token issued", { token })` while debugging and forgetting to revert. The token then appears in the Function's structured log under `traceId` — searchable, leakable, and a security issue.

**Rule**: tokens / API keys / JWTs in logs go through `maskSecret(value)` always. The issued token IS still in the response body — that is its intended destination — but it MUST NOT also appear in any `logger.*` call at full length. See `issueLivekitToken/src/main.ts` for the canonical pattern: `logger.info("token issued", { sessionId, token: maskSecret(result.body.token) })`.

### Cross-Function imports break the deployment model

Each Function is deployed independently to Appwrite Functions runtime. An `import x from "../otherFunction/src/handler"` may compile in tsup but fails at deploy time — the other Function's source is not in the deploy artifact. Worse, even if it works, it creates a hidden coupling that bypasses the contracts boundary.

**Rule**: shared logic between Functions belongs in a `packages/*` module (most often `packages/observability` for cross-cutting concerns or `packages/contracts` for schema helpers). If a helper is genuinely Function-only, file an issue proposing a `packages/functions-shared` package — do not silently cross-import.
