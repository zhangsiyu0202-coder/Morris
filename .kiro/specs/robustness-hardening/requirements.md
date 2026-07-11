# Robustness Hardening — Requirements

> Status: Wave A shipped; Wave B split into sub-specs (updated 2026-07-02)
> Author: triggered by audit of `~/posthog` engineering practices vs MerismV2 (this repo)
> Companion ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md`
> Dependencies: `foundation-setup` (shipped), `workspaces-billing` (shipped)
> Wave A (Tier 1) targets: production-readiness + security gap closure
> Wave B (Tier 2) targets: scale-readiness + LLM quality regression net

## Objective

Close the gap between MerismV2 today and the engineering practices that mature multi-tenant SaaS / AI products (PostHog as primary reference) use to stay robust at scale. Specifically:

- **Make every steering rule mechanically enforceable** so it does not silently rot into "no one ran the check".
- **Be deployable to k8s-class infra** with proper liveness/readiness/drain semantics (ADR-0006 cloud SaaS direction).
- **Close the Morris-vs-workspaces security gap** — workspaces shipped, Morris tools still trust the session.
- **Catch LLM behavior regression** before it ships, not after a researcher reports a broken analysis.

Non-goals (explicitly out of scope here, deferred or rejected — see ADR-0012):

- Co-editing / cross-workspace sharing / marketplace (permanent exclusion per `scope.md`).
- Replacing the realtime interview controller (still LiveKit Supervisor per ADR-0001).
- Adopting ClickHouse / Kafka / Dagster / Braintrust (overkill for our volume).
- A second LLM/ASR/TTS provider beyond ADR-0011 (Qwen-VL primary, DeepSeek dormant) / Qwen ASR-TTS.

## Tech Stack (touched by this spec)

| Layer | Tool | Version target |
|---|---|---|
| Pattern enforcement | semgrep | 1.x (Docker image `semgrep/semgrep`) |
| Pre-commit | husky 9 + lint-staged 16 | already in `pnpm-workspace.yaml` peer set |
| TS module boundary | dependency-cruiser | 16.x |
| Health endpoint (web) | Next.js 15 App Router route handler | already in repo |
| Health endpoint (agent) | aiohttp 3.x | already a transitive dep of livekit-agents |
| Eval framework | vitest (TS) + pytest (Py), `MERISM_RUN_EVALS=1` gate | already in repo |

No new runtime dependencies on the hot path. Semgrep + dependency-cruiser are dev-only.

## Requirements

The nine requirements below are independently testable. Each has a `MUST` clause (Wave A = binding for this spec) or `SHOULD` clause (Wave B = will be split into a sub-spec).

---

### REQ-1 (MUST, Wave A): Pattern-level enforcement via semgrep

**Problem.** `.kiro/steering/*.md` documents binding rules that have no mechanical checker today. Examples that have already been violated at least once in the repo's history:

- `errors-and-observability.md` says `try { } catch { return null|[]|{} }` is forbidden — only `grep` catches it.
- `architecture.md` says `apps/functions/*/src/handler.ts` MUST NOT import any SDK — only `grep` in steering catches it.
- `errors-and-observability.md` says no secret string literals in source — `grep` is in steering but not in CI.
- `testing.md` says no inline `vi.mock(path, () => factory)` duplicated across files — no checker exists.

**Acceptance criteria.**

1. `.semgrep/rules/` directory exists with at minimum these rules, each backed by a `*.test.ts` (positive + negative) fixture under `.semgrep/rules/tests/`:
   - `handler-no-sdk-import.yaml` — forbid `node-appwrite|appwrite|livekit-server-sdk|@livekit/server-sdk` imports inside any `apps/functions/*/src/handler.ts`.
   - `no-silent-catch-fallback.yaml` — flag `catch (...) { return null|[]|{}|undefined }` and `catch (...) { /* ignored */ }` outside files annotated `// merism:allow-silent-catch (rationale)`.
   - `no-secret-in-source.yaml` — flag literals matching `eyJhbGci|sk_(live|test)_|[A-Fa-f0-9]{32,}` in `apps/`, `packages/`, `tests/` (excluding `.env.example` placeholders).
   - `no-bare-console-in-source.yaml` — flag `console\.(log|info|debug|warn|error)` in `apps/**/*.ts(x)?`, `packages/**/*.ts(x)?` (allow in `scripts/`, `**/*.test.ts(x)?`).
   - `no-inline-vi-mock-duplicate.yaml` — flag inline factory bodies in `vi.mock(<path>, () => ({...}))` when the same `<path>` is mocked in ≥ 2 files (per `testing.md` Test double pattern §1).
2. `pnpm semgrep` script in root `package.json` runs `docker run --rm -v ${PWD}:/src semgrep/semgrep semgrep --config /src/.semgrep/rules/ /src` (or local install if available).
3. CI workflow (`.github/workflows/ci.yml`) gains a `semgrep` job with `timeout-minutes: 5`, gated by `pnpm semgrep`.
4. The CI job MUST fail-closed on any rule hit; rules that need an escape hatch use the `// merism:allow-<rule-id> (reason)` inline-comment convention.
5. Each rule's README block (YAML `metadata.docs`) explains *why* the rule exists and links to the steering section.

**Reference.** PostHog `.semgrep/rules/` has 30+ rules with `.test.{ts,py}` companions; representative files: `hogql-no-fstring.yaml` (AST taint), `sql-injection-taint.yaml`, `no-direct-kafka-producer.yaml`. See ADR-0012 for which we are and are not borrowing.

---

### REQ-2 (rejected, 2026-06-30): Husky pre-commit + pre-push hooks

**Original sketch (kept for context, NOT executed)**: Wire `husky` + `lint-staged` so a `git commit` runs the same checks CI runs (typecheck, scope-guard, prettier), and `git push` blocks pushes to `main`.

**Decision: drop entirely.** Reasoning recorded in ADR-0012 § "Behaviors we explicitly chose against":

- Local hooks are a developer-experience tool, not a robustness tool — the original question was "make the project robust", and husky doesn't change runtime behavior at all.
- CI already runs `pnpm test && pnpm typecheck && pnpm scope-guard` on every PR; the only thing pre-commit buys is failing 30 seconds earlier on local laptop, which doesn't move the needle for a solo + agent-driven workflow.
- `pre-push` blocking `main` is more robustly done via **GitHub branch protection rules** (Settings → Branches → Require pull request, Block force pushes). Server-side rules cannot be bypassed by `git push --no-verify`; client hooks can.
- Adding husky introduces a new dev dependency, a `prepare` script side effect on every clone, and a new failure surface (hooks blocking legitimate commits). Net cost > benefit at our scale.

This REQ keeps its number for traceability; no implementation tasks remain. If a future contributor wants pre-commit formatting locally, they can install `lefthook` / `husky` themselves in `.gitignore`-ed config — no project-level standardization needed.

---

### REQ-3 (MUST, Wave A): Liveness + readiness + drain endpoints

**Problem.** ADR-0006 commits us to multi-tenant cloud SaaS. None of `apps/web`, `apps/agent`, or `apps/functions/*` exposes k8s-grade health endpoints today. A bad deploy or backing-service outage today crashes user sessions before the orchestrator can route traffic away.

**Acceptance criteria.**

1. **`apps/web`**:
   - `app/_health/livez/route.ts` returns `200 { http: true }` always (until the JS runtime itself is broken).
   - `app/_health/readyz/route.ts` returns `200` iff Appwrite ping + cache (if any) are healthy; `503 { check: false, ... }` otherwise. Accepts `?role=web|interview` to scope checks.
   - Both endpoints excluded from middleware auth + analytics + Morris context injection.
   - Response body never contains a `traceId` (avoid info-leak via probes per `errors-and-observability.md`).
2. **`apps/agent`**:
   - Light HTTP server on `0.0.0.0:${HEALTH_PORT|8081}` exposing `/_livez` and `/_readyz`. Implemented with the **stdlib** `http.server` if aiohttp is realtime-only-extra; otherwise reuse aiohttp.
   - `/_readyz` checks: LiveKit websocket reachable, Appwrite ping ok, provider config loaded. NO real LLM ping (would burn tokens per probe).
   - Foundation tests (no `--extra realtime`) MUST be able to import the health module — the LiveKit check is `async` and only attempted at request time.
3. **Graceful drain** (both apps):
   - Honor a `PRESTOP_MARKER_FILE` env (default `/tmp/merism.prestop`). When the file exists, `/_readyz` returns `503 { shutting_down: true }` immediately, regardless of dependency health.
   - `apps/agent` MUST refuse new room dispatch when the marker exists; in-flight rooms run to completion. SIGTERM → write marker → wait drain → exit.
4. **Schema in contracts**: `HealthResponseSchema` in `packages/contracts/src/health.ts` (or appended to `entities.ts` if small) — both Web and Agent emit the same shape.
5. **Tests**:
   - Unit: in-memory deps for each check function (mirrors the Function pure-core pattern).
   - Property: any single-dependency failure → `/_readyz` returns 503; all healthy → 200.
   - Live (gated `MERISM_LIVE_TESTS=1`): hits Docker stack, asserts ready/live transitions during `pnpm stack:down`.

**Reference.** PostHog `posthog/health.py` — model for the role-aware `readyz` and the `is_shutting_down()` prestop check. Don't borrow the Celery-broker / ClickHouse checks (we have neither).

---

### REQ-4 (MUST, Wave A, HIGHEST PRIORITY): Morris tool declarative access control

**Problem.** ADR-0006 introduced workspaces with three coarse roles (`owner` / `admin` / `member`). Functions and server actions check workspace scope. Morris's `ToolLoopAgent` tools (`createStudyDraft`, `searchTranscriptSegments`, `getLatestAnalysisReport`, `listStudies`, `createNotebook`) currently trust the session cookie and do NOT enforce per-tool workspace scopes. A `member` calling Morris and asking "delete study X" goes through with no policy check at the tool boundary.

**Acceptance criteria.**

1. `ToolMetadata` in `apps/web/lib/assistant/tool-metadata.ts` gains:
   ```ts
   requiredScopes: ReadonlyArray<WorkspaceScope>;   // empty = read-only / no resource access needed
   resourceCheck?: {
     resource: "study" | "notebook" | "analysis";
     access: "viewer" | "editor";
     // optional: which tool input arg names the resource id (for object-level check)
     resourceIdArg?: string;
   };
   ```
   where `WorkspaceScope = "study:viewer" | "study:editor" | "notebook:viewer" | ...` lifted from `packages/contracts/src/billing.ts`.
2. New helper `withWorkspaceAccessControl(toolDef, metadata)` in `apps/web/lib/assistant/access-control.ts` wraps each tool's `execute`:
   - Before the body runs: read the active `workspaceId` from session context, resolve `member.role`, reject with structured error `MorrisToolAccessDeniedError("scope", required, granted)` if any `requiredScopes[i]` is not satisfied.
   - If `resourceCheck.resourceIdArg` is set: fetch the resource, assert its `workspaceId` matches the session's active workspace AND the member role meets `access`.
3. All 5 current Morris tools updated to declare `requiredScopes` + optional `resourceCheck`. Examples:
   - `createStudyDraft` → `["study:editor"]`
   - `searchTranscriptSegments` → `["study:viewer"]`, `resourceCheck: { resource: "study", access: "viewer", resourceIdArg: "studyId" }`
   - `getLatestAnalysisReport` → `["analysis:viewer"]`, `resourceCheck: { resource: "analysis", access: "viewer", resourceIdArg: "surveyId" }`
   - `listStudies` → `["study:viewer"]` (no `resourceCheck` — list endpoint already scopes by `workspaceId`)
   - `createNotebook` → `["notebook:editor"]`
4. Denial path:
   - Returns to the AI SDK loop as a typed tool-error message (NOT thrown — `ToolLoopAgent` would then surface to the user).
   - Logs `morris.tool.access_denied` via `createLogger` with `{ tool, requiredScopes, grantedScopes, workspaceId, memberId, traceId }`.
   - NO scope string returned to client beyond a generic copy ("You don't have access to do that here"); the precise scope leaks role assumptions.
5. Property tests (`apps/web/lib/assistant/__tests__/access-control.property.test.ts`):
   - Every workspace role passes every role-level scope check in Wave A (role-level grants are uniform; differentiation lives at the resource level).
   - For a tool with `resourceCheck.resourceIdArg` set: a `member` acting on a resource whose `creatorUserId !== member.userId` and whose required scope is `*:editor` always denies (ADR-0006 D3 write-private).
   - For a tool with `resourceCheck.resourceIdArg` set: an `owner` or `admin` acting on any resource in their workspace always passes the resource-level check regardless of creator (admin moderation surface).
   - A cross-workspace resource id (`resource.workspaceId !== session.workspaceId`) always denies regardless of role.
   - `*:viewer`-scoped tools succeed for all three roles given matching workspace, regardless of resource creator.
6. The 4 Wave B Morris tools added by `morris-memory` and `morris-conversation-persistence` MUST adopt this pattern in the same PR (no straggler workspaces-blind tools). Concretely: `manageMemories.*` → `memory:editor`, `listConversations` → no scopes (user-scoped not workspace-scoped, see `morris-memory` spec).

**Reference.** PostHog `ee/hogai/README.md` § Access control: `MaxTool.get_required_resource_access()` + `check_object_access(...)`. We are borrowing the **shape** (declarative on the tool class), not the LangChain wiring.

---

### REQ-5 (MUST, Wave A): AGENTS.md mandatory skill invocation table

**Problem.** `AGENTS.md` describes engineering skills in `~/.agents/skills/` and rationalization-blocking text, but does not list "if you touch X, you MUST first invoke Y skill". Agents drift past this guidance unless it is an explicit table mapped to trigger conditions.

**Acceptance criteria.**

1. Root `AGENTS.md` adds a new section `### Mandatory skill invocation` immediately after the existing `### Intent → Skill mapping` table. The table has two halves:
   - **Always invoke** before the first edit, every session: trigger conditions tied to files that historically eat the most context (e.g., touching `packages/contracts/src/*`, touching `apps/functions/*/src/handler.ts`, touching `apps/agent/agent/interview/*`).
   - **Invoke when in the area**: softer triggers (e.g., adding a Morris tool, writing a new Function, writing a new sub-spec).
2. Each trigger row references a real skill that exists under `~/.agents/skills/`. If a referenced skill does not exist, the row is moved to a "skills we don't have yet" stub list at the bottom of the section — so it's a known gap, not an invented dependency.
3. The section explicitly states: "If a skill listed here is not loaded before the change, the PR description must explain why."
4. CI grep guard: a `.github/workflows/ci.yml` step `grep -RIn 'Mandatory skill invocation' AGENTS.md` (presence-only check) so the section can't be silently removed.

**Reference.** PostHog `AGENTS.md` § `Mandatory skill invocation` is verbatim borrowable in shape. The table contents are MerismV2-specific.

---

### REQ-6 (SHOULD, Wave B, sub-spec): TS module boundary via dependency-cruiser

**Problem.** `architecture.md` documents binding import rules (`handler.ts` no-SDK, `apps/web/lib/queries/*` no cross-imports, `apps/agent/agent/interview/*` no top-level livekit import). We have **grep examples** in steering. PostHog uses `tach` + `import-linter` to make these mechanical. TS analog: `dependency-cruiser`.

**Acceptance criteria (sketch — full spec in `dependency-cruiser-boundaries` sub-spec).**

1. `.dependency-cruiser.cjs` with explicit `forbidden` rules per `architecture.md` Globally Forbidden + Module map.
2. `pnpm depcruise` script + CI step (3-min timeout).
3. Each existing module gets a corresponding rule; deviations require a comment in `architecture.md` documenting the exemption + rationale.

**Reference.** PostHog `tach.toml` for the policy shape; `dependency-cruiser` is the TS analog.

---

### REQ-7 (SHOULD, Wave B, sub-spec): AI eval suite + LLM behavior regression net

**Problem.** Current tests cover state-machine workflow (`workflow.py`), Morris tool routing (`tool-metadata`), and Function shape (handler purity). **Nothing catches "the LLM started producing worse analysis"** — the primary risk surface of an AI-driven product.

**Acceptance criteria (sketch — full spec in `ai-eval-suite` sub-spec).**

1. `tests/evals/` directory with:
   - `fixtures/` — curated transcript snippets, Survey drafts, analysis report skeletons.
   - `scorers/` — deterministic and LLM-as-judge scorers (`AnalysisCitesTranscript`, `WorkflowAdvancesToNextSection`, `MorrisPicksRightTool`).
   - `cases/` — one file per scenario, exporting an array of `{ input, expected, scorer[] }`.
2. `pnpm eval` gated by `MERISM_RUN_EVALS=1` (default off; CI nightly only). Runs against real Qwen-VL + DeepSeek.
3. `pnpm eval:fake` runs the same cases against deterministic fakes (`MERISM_FAKE_PROVIDERS=1`) so structural regressions are caught on every PR without burning tokens.
4. Initial 3 eval bundles:
   - `analyze-session.eval.ts` — given fixture transcript, the produced `AnalysisReport.themes[]` MUST cite ≥ 1 segment per theme and reach a structural similarity floor against the expected output.
   - `supervisor-advancement.eval.py` — given a recorded section state, the supervisor's next-section decision matches the expected one in ≥ 90% of N runs.
   - `morris-tool-routing.eval.ts` — for K seed prompts, Morris picks the same tool as the human-labeled gold in ≥ 85% of runs.

**Reference.** PostHog `ee/hogai/eval/ci/*.py` and `ee/hogai/eval/scorers/*.py` — borrow the structural shape (pytest case → scorer chain → score aggregation). Skip Braintrust integration; emit results to JSON + posthog `createLogger` instead. ADR-0012 records why we don't pull in Dagster / sandboxed-subprocess infra at this stage.

---

### REQ-8 (SHOULD, Wave B, sub-spec): Declarative resource limit registry

**Problem.** ADR-0006 introduces a `Plus` / `Pro` plan model with usage allowances. Today, limit checks (e.g., "max studies per workspace", "max active interview links per workspace") would naturally accrete as scattered constants. PostHog has a registry pattern that keeps the catalog typed, tier-aware, and centrally evaluated.

**Acceptance criteria (sketch — full spec in `resource-limits-registry` sub-spec).**

1. `packages/contracts/src/limits.ts` exports a `LimitKey` enum + a typed `REGISTRY: Record<LimitKey, LimitDefinition>` where `LimitDefinition` carries `description`, `unit`, `default`, and optional `byPlanTier`.
2. `apps/web/lib/limits/check.ts` exports `checkCountLimit({ workspaceId, key, currentCount, member })` → either passes silently or emits a structured `resource.limit.hit` event via `createLogger`. NEVER blocks the create (PostHog policy, lifted intentionally).
3. Hard limits (where we DO block — e.g., abuse vectors like 10k links/hour) live in a separate `enforceCountLimit` helper that throws a typed `LimitExceededError` mapped to `429 too_many_resources` at the boundary.

**Reference.** PostHog `posthog/resource_limits/{registry,evaluator}.py`. Replace `team_id` with `workspaceId`, `Organization.get_plan_tier()` with `WorkspaceMember.planTier`.

---

### REQ-9 (SHOULD, Wave B, sub-spec): Prompt version + golden tests for analysis Functions

**Problem.** `apps/functions/analyzeSession` and `analyzeSurvey` have prompts hardcoded in their `deps.ts`. Tuning a prompt today is `git diff deps.ts` — no version, no A/B, no golden file regression.

**Acceptance criteria (sketch — full spec in `prompt-versioning` sub-spec).**

1. Each analysis Function gains a `src/prompts/<version>/` directory (e.g. `v1/`, `v2/`). One version is the active export; the others are kept for comparison.
2. `tests/golden/<function>/<version>/` — for each fixture input, an expected (structurally checked, not byte-exact) output. Snapshot is reviewed on diff.
3. CI runs `pnpm test:golden` against fakes (deterministic responses keyed off the fixture input) so the golden test catches structural regressions cheaply; the eval suite from REQ-7 catches semantic regressions on real LLMs nightly.
4. The active prompt version is selected via env (`ANALYZE_SESSION_PROMPT_VERSION=v2`) so we can stage a new version in stg before promoting.

**Reference.** PostHog `products/ai_observability/frontend/playground/` + `prompts/` for the *experiment* shape. We borrow versioning + golden tests only; the playground UI is way too much for our scale today.

---

## Success Criteria (whole spec)

The spec is "done" when all of the following are true:

- [ ] Every Wave A requirement (REQ-1 through REQ-5) has shipped and `pnpm test && pnpm typecheck && pnpm semgrep && pnpm test:py` all pass locally.
- [ ] Every Wave A requirement has at least one property test or live integration test (per `testing.md`).
- [ ] Wave B requirements (REQ-6 through REQ-9) have their own sub-specs filed in `.kiro/specs/<name>/` with `requirements.md` at minimum. They are NOT required to ship in this wave.
- [ ] `docs/adr/0012-borrow-engineering-practices-from-posthog.md` is committed.
- [ ] `AGENTS.md` references this spec from the relevant sections (skill invocation table, scope-guard, husky hooks).
- [ ] No regression in CI runtime (Wave A adds ≤ 3 minutes of CI per workflow run, measured).
- [ ] No production secrets leak via the new health endpoints (verified by REQ-3 property test).

## Boundaries

- **Always**:
  - Make every binding rule mechanically checkable before merging this spec's Wave A.
  - Cite the PostHog file path next to each borrowed pattern.
  - Treat workspaces / billing surfaces as the explicit scope-guard exemption per `scope.md`.
- **Ask first**:
  - Adding any new dev dependency outside the list in Tech Stack above.
  - Touching `packages/contracts/src/billing.ts` to add a new `WorkspaceScope` value.
  - Adding a new CI workflow file (only Wave A change: one new job in existing `ci.yml`).
  - Adding a new env flag (REQ-3's `HEALTH_PORT`, `PRESTOP_MARKER_FILE`; REQ-7's `MERISM_RUN_EVALS`) — register in `errors-and-observability.md` § Feature flags.
- **Never**:
  - Lift a scope-guard forbidden concept under the cover of "robustness".
  - Adopt LangChain / LangGraph for tool wiring (REQ-4 is a thin wrapper, not a controller).
  - Adopt PostHog `tach.toml` verbatim — TS surface uses dependency-cruiser (REQ-6).
  - Emit secret values to the new health endpoints' response bodies or logs.

## Open Questions

1. **DECIDED (2026-06-30): Morris access-control denial message format.** Production returns a generic copy ("You don't have access to do that here.") to ALL users. Developer mode — when `MERISM_DEBUG_PROVIDERS=1` is set AND `NODE_ENV !== "production"` — appends a `[DEBUG]` block with the missing scope, the granted scopes, and the role. The DEBUG branch is gated by BOTH conditions so a leaked env var in prod is still safe. Implemented in `withWorkspaceAccessControl` (REQ-4 / Task 1.3).
2. **Q: Eval CI cadence — nightly or weekly?** Token cost vs regression window. Default in spec: nightly + on-demand. Re-evaluate when Wave B / REQ-7 sub-spec is drafted.
3. **Q: Do we expose `/_readyz?role=X` to anonymous interviewees (probe from a Vercel-style edge) or restrict to internal IPs?** Default: open, since the response body is constant-shape with no secrets. Decision deferred to Phase 2 / Task 2.2.
