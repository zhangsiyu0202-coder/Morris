# Design: `lint-baseline-cleanup`

> **Parent**: `.kiro/specs/lint-baseline-cleanup/requirements.md`
> **Date**: 2026-06-30
> **Status**: design complete, ready for tasks.md.

## Open question resolutions

### Q1 — PR cadence: **single PR**

Pros of single PR: one diff to review, one CI run, one revert if needed. Each
hunk is 1-3 lines of mechanical change; reviewer can scan in one pass. Aligns
with the spec's "Estimated effort: 0.5 day" framing.

Pros of small PRs (rejected): isolated bisect, smaller blast radius. But the
blast radius IS small — we're either adding `nosemgrep:` comments or replacing
`console.X` with `logger.X`. Both reversible per-site. Bisect granularity isn't
worth the cadence overhead.

**Decision**: one PR for the full 36-finding sweep + severity promotion + ADR
update. If the PR exceeds ~50 hunks in review, split as a fallback.

### Q2 — Logger scope naming for non-LLM `createLogger` callers: **module-first, action-prefixed for server actions**

The LLM-call observability registry (`.kiro/steering/errors-and-observability.md` §
LLM call observability) defines `^(morris|function|action)\.[a-zA-Z][\w-]*$`
for the `LLMCallEvent.scope` field. That regex governs **LLM-call observability
specifically**, not the broader `createLogger(scope)` contract.

For the broader logger, the steering says only "scope identifies the entry
point" and the file lists examples like `action.conversations` (for server
action lifecycle events) and `memories.embed` (for a background task module).
Pattern observation: when a logger lives inside a Server Action, scope is
`action.<feature>.<entity>`; when it's a module-level utility, scope is
`<module>.<entity>` directly.

This sub-spec adopts that pattern uniformly:

| Caller location | Scope template | Example |
|---|---|---|
| `apps/web/lib/actions/<feature>.ts` (Server Action) | `action.<feature>.<entity>` | `action.guide-ai.generate` |
| `apps/web/app/api/<route>/route.ts` (route handler) | `route.<route>.<method>` | `route.assistant.post` |
| `apps/web/lib/<module>/<file>.ts` (module utility) | `<module>.<entity>` | `queries.studies` / `interview.transport` |
| `apps/web/components/**/*.tsx` (component) | `component.<feature>.<componentName>` | `component.assistant.tool-results` |

Constraint: scope MUST NOT match the LLM-call regex unless the call actually IS
an LLM call (otherwise `withLLMCall` invariants get confused). All new scopes
above start with `route.` / `queries.` / `interview.` / `component.` — none of
which collide with the LLM-call prefixes (`morris.` / `function.` / `action.`).

`action.<feature>.*` is the one prefix shared with LLM-call observability — but
the LLM-call regex requires AT LEAST TWO dot-separated segments after `action.`,
so `action.guide-ai.generate` is a valid LLM-call scope shape AND a valid
non-LLM logger scope. Disambiguation is via the EVENT name (`llm.call` for LLM
events, free-form for others), not the scope prefix.

### Q3 — Best-effort helper vs `nosemgrep:` annotations: **`nosemgrep:` for Wave A; helper deferred**

Most `no-silent-catch-fallback` findings are in `apps/functions/*/src/deps.ts`
files where the catch IS legitimate best-effort cleanup (reclaim orphan slots,
ignore stale stripe events, skip non-blocking metric emit). A
`bestEffort(fn, logger, reason)` helper would:

- DRY ~5-7 sites (~25% of the total)
- Force every site to declare its reason in code (good) and emit a structured
  log line on swallow (good — currently most silently return without logging)
- Add a new primitive in `packages/observability`, which means: tests, types,
  consumer migration, doc update

For a 0.5-day Wave A, that's too much surface. The helper is worth doing — but
in its own sub-spec where the value can be measured against the migration cost
fairly. **For now**: each silent-catch site gets a `nosemgrep:` comment with a
human-readable reason. The reason ITSELF documents what a future helper would
encode formally.

**Future**: when `nosemgrep:` annotations exceed ~10 with the same rationale
pattern ("best-effort cleanup on idempotent operation"), file a follow-up
sub-spec `observability-besteffort-helper` to lift them.

### Q4 — Categorical decision per finding-type pattern

Looking across the 36 sites, the resolution patterns crystallize as:

**no-silent-catch-fallback (20 sites)** — 3 categories:

1. **Auth lookups returning null** (`auth/current-user.ts`, `auth/workspace.ts`,
   `queries/auth.ts`): `try { sdk.account.get() } catch { return null }`.
   Translating "no session" / "session expired" to `null` is **correct typed
   behavior** — the caller's contract is "user or null". Resolution:
   `nosemgrep:` + reason "no session translates to null (typed contract)".

2. **Function deps best-effort cleanup** (`issueLivekitToken/deps.ts:148`,
   `stripeWebhook/deps.ts`, `inviteMember/deps.ts`, `analyzeSession/quality-flags.ts`,
   `aggregateWorkspaceUsage/deps.ts`, `changePlan/deps.ts`):
   reclaim-orphans / ignore-stale-events / metric-emit. Resolution:
   `nosemgrep:` + reason "best-effort cleanup, failure is non-blocking".

3. **Module utilities returning fallback** (`survey/read.ts`,
   `interview/transport.ts`, `dashboard/run-widgets.ts`, `queries/auth.ts`,
   `dev-issue-token`): some are real defects that should LOG + propagate; others
   are typed-fallback patterns. Per-site triage.

**no-bare-console-in-source (16 sites)** — 2 categories:

1. **`console.error` / `console.warn` for genuine errors** (route handlers,
   server actions, lib utilities): replace with `createLogger(scope).error(...)`
   / `.warn(...)`. Threading `traceId` is easy where it exists; new
   `createLogger` calls at function entry create one.

2. **Dev-only / scaffold templates** (`tool-template.ts`, `dev-issue-token`):
   either migrate to logger or `nosemgrep:` if it's a true dev surface.
   Per-site triage.

## File-by-file plan

### no-silent-catch-fallback resolutions

| File:line | Category | Resolution |
|---|---|---|
| `apps/functions/aggregateWorkspaceUsage/src/deps.ts:47` | 2 | nosemgrep — usage event emit, best-effort |
| `apps/functions/analyzeSession/src/quality-flags.ts:81` | 2 | nosemgrep — defensive parse, fall back to empty flags |
| `apps/functions/changePlan/src/deps.ts:18` | 1 | nosemgrep — billing lookup, null = "no subscription yet" |
| `apps/functions/inviteMember/src/deps.ts:24` | 1 | nosemgrep — membership lookup, null = "not a member yet" |
| `apps/functions/inviteMember/src/deps.ts:39` | 2 | nosemgrep — invitation lookup, null = "invite already consumed/expired" |
| `apps/functions/issueLivekitToken/src/deps.ts:148` | 2 | nosemgrep — orphan reclaim, failure is non-blocking |
| `apps/functions/stripeWebhook/src/deps.ts:74` | 2 | nosemgrep — idempotent stripe event lookup |
| `apps/web/app/api/dev-issue-token/route.ts:128` | 2 | nosemgrep — dev-only route, best-effort |
| `apps/web/lib/auth/current-user.ts:16` | 1 | nosemgrep — Appwrite Account.get, null = no session |
| `apps/web/lib/auth/current-user.ts:23` | 1 | nosemgrep — workspace cookie parse, null = unset |
| `apps/web/lib/auth/workspace.ts:25` | 1 | nosemgrep — cookie parse, null = unset |
| `apps/web/lib/dashboard/run-widgets.ts:34` | 3 | rewrite — log error + skip widget (currently silently drops) |
| `apps/web/lib/interview/transport.ts:70` | 3 | rewrite — log + return null (currently silent) |
| `apps/web/lib/interview/transport.ts:90` | 3 | rewrite — log + return null |
| `apps/web/lib/interview/transport.ts:228` | 3 | rewrite — log + return null |
| `apps/web/lib/queries/auth.ts:28` | 1 | nosemgrep — session check, null = no session |
| `apps/web/lib/queries/auth.ts:72` | 1 | nosemgrep — workspace lookup, null = no workspace |
| `apps/web/lib/survey/read.ts:57` | 3 | nosemgrep — survey read fallback, OR rewrite to log |
| `apps/web/lib/survey/read.ts:133` | 3 | nosemgrep — sections read fallback |
| `apps/web/lib/survey/read.ts:190` | 3 | nosemgrep — questions read fallback |

Net: 16 `nosemgrep:` + 4 rewrites (`interview/transport.ts` ×3 + `dashboard/run-widgets.ts`).

### no-bare-console-in-source resolutions

| File:line | Resolution |
|---|---|
| `apps/web/app/api/assistant/route.ts:59,104,112` | migrate to `createLogger("route.assistant.post")` (route handler creates logger at entry, reuses) |
| `apps/web/app/api/dev-issue-token/route.ts:249` | migrate to `createLogger("route.dev-issue-token.post")` |
| `apps/web/components/assistant/tool-results.tsx:292` | migrate to `createLogger("component.assistant.tool-results")` (rare client-component log; logger works in both) |
| `apps/web/lib/actions/guide-ai.ts:107,150` | migrate to `createLogger("action.guide-ai.generate")` / `expand-section` |
| `apps/web/lib/actions/notebooks.ts:194` | migrate to `createLogger("action.notebooks.createNotebook")` |
| `apps/web/lib/assistant/tool-template.ts:21,26` | nosemgrep — file IS the template/scaffold that copy-paste authors of new tools start from; `console.log` is the placeholder telling the author "replace with your logger" |
| `apps/web/lib/interview/issue-token.ts:55,81,86,106` | migrate to `createLogger("interview.issue-token")` |
| `apps/web/lib/queries/studies.ts:24` | migrate to `createLogger("queries.studies").warn(...)` (already a `console.warn` for "dropped row failing schema check") |
| `apps/web/lib/server/notebooks.ts:143` | migrate to `createLogger("server.notebooks")` |

Net: 14 `createLogger` migrations + 2 `nosemgrep:` (the template file's two calls — they're the intentional scaffold placeholder).

## Verification plan

After all edits applied:

```bash
pnpm semgrep:warn 2>&1 | grep -E "Ran.*findings"
# Expect: "Ran 2 rules on N files: 0 findings."

pnpm semgrep
# Expect: same (since severity will be promoted to ERROR in Phase C)

pnpm test && pnpm typecheck && pnpm test:py && pnpm scope-guard
# All green.
```

## Risks

1. **Logger threading**: a `createLogger(scope)` call inside a `catch` block
   without an upstream `traceId` source creates a fresh one — that's per the
   logger contract (each entry point gets its own traceId) but means the log
   line won't correlate with any caller trace. Acceptable for the
   `lib/queries/*` and `lib/server/*` migration where the trace originates
   from the consuming Server Action / route handler that ALREADY has its own
   logger. The leaf logger gets a fresh `traceId`; the parent's log line in
   the same code path also has a separate `traceId` from the parent's
   `createLogger` call at entry. They don't chain. Acceptable per the
   "one logger per Function invocation" contract.

2. **`tool-template.ts` is a scaffold**: if migrated to `createLogger`, a new
   tool author copy-pasting from the template will inherit the scope name
   `template.scaffold` and probably ship it. Better to keep `console.log` as
   the placeholder *with a `nosemgrep:` comment that's also a TODO to the
   reader* — "// nosemgrep: no-bare-console-in-source (template placeholder;
   replace with createLogger(scope) in your tool)".

3. **Rewrite category 3 catches**: 4 sites currently silently drop errors
   (`interview/transport.ts` ×3, `dashboard/run-widgets.ts`). Rewriting them to
   log + propagate could surface previously-hidden defects. That's a feature,
   not a bug — but the PR description should call out the change so a reviewer
   can verify the new logs are useful and not noisy.

## References

- Parent spec: `.kiro/specs/lint-baseline-cleanup/requirements.md`
- Parent: `.kiro/specs/robustness-hardening/{requirements,design,tasks}.md`
- Steering: `.kiro/steering/errors-and-observability.md` § try/catch matrix + Logger contract
- ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md` (gets a promotion entry in this sub-spec's Phase D)
