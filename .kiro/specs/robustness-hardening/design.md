# Robustness Hardening — Design

> Companion to `requirements.md` and `tasks.md` in the same directory.
> Sourced from a `~/posthog` engineering audit (2026-06-30). Each section cites the PostHog reference file path so the borrow is verifiable per `pre-implementation.md` § GitHub reference research.

## Architectural posture

The MerismV2 codebase already has the **right shape** for a multi-tenant AI SaaS:

- Single source of truth contracts (`packages/contracts`), Python pydantic mirror.
- Pure-core / SDK-wrapper Function shape (`apps/functions/<name>/{handler,main,deps}.ts`).
- Observability primitives (`createLogger`, `withErrorBoundary`, `withRetry`, `withLLMCall`, `llmObservabilityMiddleware`, `llmGate`).
- Property-based test harness for permission/secret-leakage/state-machine invariants.
- Workspaces / billing / usage metering (ADR-0006) narrowed via `EXEMPT_PREFIXES` in `scope-guard.ts`.

What's missing is **enforcement of the rules we already wrote** plus **deploy-readiness for the cloud SaaS direction**. This spec is the lateral fix for that — no architectural pivot.

```
                    ┌──────────────────────────────┐
                    │   Steering rules (prose)     │
                    │   .kiro/steering/*.md         │
                    └──────────┬───────────────────┘
                               │ today: prose-only
                               │ this spec adds ↓
        ┌──────────────────────┼──────────────────────────┐
        │                      │                          │
        ▼                      ▼                          ▼
 ┌────────────┐        ┌──────────────┐         ┌──────────────────┐
 │  semgrep   │        │ husky hooks  │         │ dependency-cruise│
 │ (REQ-1)    │        │ (REQ-2)      │         │ (REQ-6, Wave B)  │
 └────────────┘        └──────────────┘         └──────────────────┘
       │                      │                          │
       └──── CI fail-closed ──┴──── pre-commit/push  ────┘

                    ┌──────────────────────────────┐
                    │  Cloud SaaS deploy surface   │
                    │  (ADR-0006)                  │
                    └──────────┬───────────────────┘
                               │ today: no probes
                               │ this spec adds ↓
                ┌──────────────┴──────────────┐
                ▼                              ▼
        /_livez + /_readyz             prestop marker
        (REQ-3, Web + Agent)           graceful drain

                    ┌──────────────────────────────┐
                    │  Workspaces + Morris tools   │
                    │  (ADR-0006 + morris-* specs) │
                    └──────────┬───────────────────┘
                               │ today: workspaces ✓
                               │       tool access ✗ ← gap
                ┌──────────────┴──────────────┐
                ▼                              ▼
        ToolMetadata.requiredScopes    withWorkspaceAccessControl
        (REQ-4)                        (REQ-4)
```

## REQ-1 design: Semgrep rules

### Layout

```
.semgrep/
├── rules/
│   ├── handler-no-sdk-import.yaml
│   ├── no-silent-catch-fallback.yaml
│   ├── no-secret-in-source.yaml
│   ├── no-bare-console-in-source.yaml
│   ├── no-inline-vi-mock-duplicate.yaml
│   └── tests/
│       ├── handler-no-sdk-import.test.ts          # positive samples
│       ├── handler-no-sdk-import.allowed.test.ts  # negative samples
│       └── ... one pair per rule ...
└── README.md   # rule index + how to add new rules
```

PostHog reference: `/home/jia/posthog/.semgrep/rules/{*.yaml,*.py}` + `/home/jia/posthog/.semgrep/rules/tests/*.py`. We match the `<name>.yaml` + `<name>.test.<ext>` convention.

### Rule pattern shapes

Each rule YAML follows semgrep's canonical structure:

```yaml
rules:
  - id: handler-no-sdk-import
    languages: [typescript, javascript]
    message: |
      `apps/functions/*/src/handler.ts` must not import SDKs.
      Move the import to `main.ts` and inject the dependency via `Deps`.
      See `.kiro/steering/architecture.md` § Function shape.
    severity: ERROR
    paths:
      include:
        - "apps/functions/*/src/handler.ts"
    pattern-either:
      - pattern: 'import $X from "node-appwrite"'
      - pattern: 'import $X from "appwrite"'
      - pattern: 'import $X from "livekit-server-sdk"'
      - pattern: 'import $X from "@livekit/server-sdk"'
    metadata:
      docs: ".kiro/steering/architecture.md#function-shape-binding"
      owner: "@platform"
```

For `no-silent-catch-fallback`, the pattern uses semgrep's metavariable + pattern-not to allow the escape-hatch comment:

```yaml
rules:
  - id: no-silent-catch-fallback
    languages: [typescript, javascript]
    message: |
      Catch blocks must not silently return defaults. Either re-throw,
      log + propagate, or annotate with `// merism:allow-silent-catch (reason)`.
      See `.kiro/steering/errors-and-observability.md` § try/catch matrix.
    severity: ERROR
    pattern-either:
      - pattern: "try { ... } catch { return $X }"  # any literal default
      - pattern: "try { ... } catch ($E) { return $X }"
    pattern-not-regex: 'merism:allow-silent-catch'
    paths:
      include: ["apps/", "packages/"]
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"]
```

### CI integration

A single `semgrep` job is added to `.github/workflows/ci.yml` (existing file). It runs via Docker so we don't need to install semgrep on the runner:

```yaml
semgrep:
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - name: Run semgrep
      run: |
        docker run --rm -v "${{ github.workspace }}:/src" \
          semgrep/semgrep:1 \
          semgrep --config /src/.semgrep/rules/ /src \
            --error \
            --quiet
```

`--error` makes any finding fail the job. The job is *additional* to existing checks — semgrep failures do NOT prevent typecheck / tests from running (parallel jobs).

### Why we are NOT borrowing all 30 PostHog rules

The PostHog rules tackle ClickHouse + HogQL + Django ORM + Kafka — none of which we run. We borrow only the **structural shape** + the rules that map 1:1 onto our steering files. New rules added later go through the same convention.

## REQ-2 design: Husky hooks (REJECTED, 2026-06-30)

The original design pulled in `husky` + `lint-staged` for pre-commit / pre-push. **Rejected** — full reasoning in `requirements.md` REQ-2 and ADR-0012 § "Behaviors we explicitly chose against". Short version: husky is a developer-experience tool, not a robustness tool. CI is the canonical guard for the same checks; pre-push main-protection is better served by GitHub server-side branch protection.

No implementation tasks remain for REQ-2. Future contributors who want local pre-commit formatting can install their own (lefthook / husky / pre-commit) in personally-gitignored config — no project-level standardization needed.

## REQ-3 design: Health + drain

### Endpoint contract

`packages/contracts/src/health.ts` (new file):

```ts
import { z } from "zod";

export const HealthRoleSchema = z.enum(["web", "interview", "agent", "function"]);
export type HealthRole = z.infer<typeof HealthRoleSchema>;

export const HealthCheckSchema = z.object({
  http: z.boolean().optional(),
  appwrite: z.boolean().optional(),
  livekit: z.boolean().optional(),
  cache: z.boolean().optional(),
  providers: z.boolean().optional(),
  shutting_down: z.boolean().optional(),
});

export const HealthResponseSchema = HealthCheckSchema.extend({
  role: HealthRoleSchema.optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
```

Response body MUST NOT include `traceId` (info-leak risk on a probe endpoint) — explicitly tested.

### Web implementation

`apps/web/app/_health/livez/route.ts`:
```ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ http: true }, { status: 200 });
}
```

`apps/web/app/_health/readyz/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { isShuttingDown } from "@/lib/health/prestop";
import { runReadinessChecks, RoleDependencies } from "@/lib/health/checks";
import { HealthRoleSchema } from "@merism/contracts/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (isShuttingDown()) {
    return NextResponse.json({ shutting_down: true }, { status: 503 });
  }
  const role = HealthRoleSchema.safeParse(req.nextUrl.searchParams.get("role"));
  const deps = role.success ? RoleDependencies[role.data] : RoleDependencies.web;
  const results = await runReadinessChecks(deps);
  const ok = Object.values(results).every(Boolean);
  return NextResponse.json(results, { status: ok ? 200 : 503 });
}
```

`apps/web/lib/health/checks.ts` exposes typed deps (`pingAppwrite`, `pingCache`) wired with timeouts (3s each). Per-check failure logs at `debug` level (not error — these are routine probe outcomes).

### Agent implementation

LiveKit Agent Worker is a long-running Python process. Add a tiny `aiohttp` server alongside the worker:

`apps/agent/agent/health.py`:
```python
"""Lightweight health server for k8s probes.

Runs on HEALTH_PORT (default 8081). Independent of the LiveKit worker port —
the worker can be 100% busy and the probe must still answer.
"""
import os
import asyncio
from aiohttp import web

from agent.logging import create_logger

logger = create_logger("agent.health")

PRESTOP_MARKER = os.environ.get("MERISM_PRESTOP_MARKER_FILE", "/tmp/merism.prestop")


def is_shutting_down() -> bool:
    return os.path.exists(PRESTOP_MARKER)


async def livez(_req: web.Request) -> web.Response:
    return web.json_response({"http": True})


async def readyz(req: web.Request) -> web.Response:
    if is_shutting_down():
        return web.json_response({"shutting_down": True}, status=503)
    # Lazy import (per architecture.md realtime extras opt-in)
    from agent.health_checks import check_appwrite, check_livekit
    results = {
        "appwrite": await check_appwrite(timeout=3),
        "livekit": await check_livekit(timeout=3),
    }
    ok = all(results.values())
    return web.json_response(results, status=200 if ok else 503)


def make_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/_livez", livez)
    app.router.add_get("/_readyz", readyz)
    return app


async def start_health_server(port: int | None = None) -> web.AppRunner:
    runner = web.AppRunner(make_app())
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port or int(os.environ.get("HEALTH_PORT", "8081")))
    await site.start()
    logger.info("agent.health.started", port=site._server.sockets[0].getsockname()[1])
    return runner
```

Wired into `agent/main.py` as a sidecar coroutine, NOT a separate process — same lifecycle as the worker.

### Graceful drain

Both Web and Agent honor a single `MERISM_PRESTOP_MARKER_FILE` env. The k8s `preStop` hook (when we deploy) runs:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "touch /tmp/merism.prestop && sleep 30"]
```

- Marker → `/_readyz` returns 503 → orchestrator stops sending traffic.
- Sleep gives in-flight requests / rooms time to drain.
- After 30s, k8s SIGTERMs the pod. The agent's existing TaskGroup tear-down handles in-flight rooms.

For Wave A this is **infrastructure-ready**, not actually deployed (we don't have k8s yet). The marker logic ships now so when we add k8s manifests later, no app-side change is needed.

PostHog reference: `/home/jia/posthog/posthog/health.py` lines 1-150. We borrow `livez` / `readyz` / `is_shutting_down` semantics and skip the celery/clickhouse/postgres-migration checks (no equivalent in our stack).

## REQ-4 design: Morris tool access control

### Type extensions

`apps/web/lib/assistant/tool-metadata.ts` (extending the existing per-tool metadata object — per `morris-tool-metadata` sub-spec):

```ts
import type { WorkspaceScope } from "@merism/contracts/billing";

export type ResourceCheckSpec =
  | {
      resource: "study";
      access: "viewer" | "editor";
      resourceIdArg?: string;
    }
  | {
      resource: "notebook";
      access: "viewer" | "editor";
      resourceIdArg?: string;
    }
  | {
      resource: "analysis";
      access: "viewer" | "editor";
      resourceIdArg?: string;
    }
  | {
      resource: "memory";
      access: "viewer" | "editor";
      // memory is per-user, not per-workspace — no resourceIdArg needed
    };

export interface ToolMetadata {
  // ... existing fields ...
  requiredScopes: ReadonlyArray<WorkspaceScope>;
  resourceCheck?: ResourceCheckSpec;
}
```

`WorkspaceScope` is a new contract field in `packages/contracts/src/billing.ts`. Today the billing contract has roles (`owner`/`admin`/`member`); we add a derived scope set. The neighbor enum naming style (per existing `WorkspaceRole`) is no-`Schema`-suffix, so we follow it:

```ts
export const WorkspaceScope = z.enum([
  "study:viewer", "study:editor",
  "notebook:viewer", "notebook:editor",
  "analysis:viewer",   // analysis is read-only — researchers can't edit auto-generated reports
  "memory:viewer", "memory:editor",
]);
export type WorkspaceScopeValue = z.infer<typeof WorkspaceScope>;

// Role-level grant: in Wave A, all three workspace roles hold the full scope
// set. The "write-private" half of ADR-0006 D3 (you can edit your OWN study
// but not someone else's) is NOT enforced here — it is enforced at the
// resource level by `withWorkspaceAccessControl`'s `resourceCheck` step,
// where the creator-of-record is compared to the acting member.
//
// Why keep the layer at all if it's currently degenerate? Future scopes that
// ARE role-differentiated (e.g. `workspace:settings`, `billing:edit`) plug in
// here without rewriting the wrapper. Memory is per-user, not per-workspace —
// `memory:editor` for every role is the user-scope literal pass-through.
const ALL_SCOPES: readonly WorkspaceScopeValue[] = WorkspaceScope.options;
export const ROLE_SCOPES: Record<WorkspaceRoleValue, readonly WorkspaceScopeValue[]> = {
  owner: ALL_SCOPES,
  admin: ALL_SCOPES,
  member: ALL_SCOPES,
};
```

NOTE: `member` keeps every scope at the role level. Whether a `member` can `study:editor` a SPECIFIC study depends on whether they created it — that's the `resourceCheck` step in Task 1.3, not the role-level grant.

### Wrapper

`apps/web/lib/assistant/access-control.ts` — exposes a single imperative `checkWorkspaceAccess(ctx, opts)` helper that mirrors the existing `if (!ownerUserId) return NOT_SIGNED_IN` short-circuit at the top of every tool's `execute`. Returns `null` on success (tool body proceeds) or a `ToolResultEnvelope<ToolErrorArtifact>` on denial (tool body returns it directly — fits the existing envelope contract in `envelope.ts`).

Why imperative not HoF: AI SDK 6 `tool({ execute })` is itself a closure, and the existing tool builder pattern is `buildXxxTool(ctx) → { metadata, spec: tool(...) }`. Wrapping the inner `execute` as a HoF would require either (a) re-wiring every tool builder, or (b) wrapping at `tool()` construction time — at which point we don't yet have the resource id needed for resource-level checks. The imperative form lets the tool call the check exactly where it has the relevant data.

```ts
import { ROLE_SCOPES, type WorkspaceRoleValue, type WorkspaceScopeValue } from "@merism/contracts";
import { createLogger } from "@merism/observability";
import type { ToolErrorArtifact, ToolResultEnvelope } from "./envelope";

export interface WorkspaceAccessContext {
  workspaceId: string;
  memberId: string;
  role: WorkspaceRoleValue;
  traceId: string;
}

export interface ResourceForAccessCheck {
  workspaceId: string;
  creatorUserId: string;
}

interface CheckAccessOptions {
  toolName: string;
  requiredScopes: readonly WorkspaceScopeValue[];
  resource?: {
    /** null = no resource check (CREATE operations); caller passes a loaded record otherwise. */
    record: ResourceForAccessCheck | null;
    access: "viewer" | "editor";
  };
}

/**
 * Single-call workspace access check. Returns `null` on grant, a denial
 * envelope on reject. Denial message is generic for production users; in
 * dev mode (NODE_ENV !== "production" AND MERISM_DEBUG_PROVIDERS === "1")
 * a [DEBUG] block reveals missing scopes / role / reason.
 *
 * Two-layer policy:
 *  1. Role-level: do required scopes intersect ROLE_SCOPES[ctx.role]?
 *  2. Resource-level (only if `resource.record` supplied):
 *     - cross-workspace deny: resource.workspaceId must equal ctx.workspaceId
 *     - editor-on-someone-else deny: for access="editor", must be creator OR admin/owner
 *       (this is the ADR-0006 D3 "write-private" gate, kept out of role-level)
 */
export function checkWorkspaceAccess(
  ctx: WorkspaceAccessContext,
  opts: CheckAccessOptions,
): ToolResultEnvelope<ToolErrorArtifact> | null;
```

Call-site shape inside a tool:

```ts
async execute(input) {
  // 1. role-level (no resource handle yet — works for CREATE)
  const denied = checkWorkspaceAccess(ctx.workspace, {
    toolName: "createStudyDraft",
    requiredScopes: ["study:editor"],
  });
  if (denied) return denied;

  // 2. resource-level (for UPDATE/READ on a specific id)
  const study = await loadStudy(input.studyId);
  const denied2 = checkWorkspaceAccess(ctx.workspace, {
    toolName: "updateStudyDraft",
    requiredScopes: ["study:editor"],
    resource: { record: study, access: "editor" },
  });
  if (denied2) return denied2;

  // ... tool body ...
}
```

PostHog reference: `/home/jia/posthog/ee/hogai/README.md` § Access control. We borrow the **two-layer policy** (role + resource) but flip from PostHog's class-decorator pattern to imperative because our tool builder is a functional closure, not a class.

### Tool migration

Each of the 5 current tools gets its `execute` wrapped + its metadata updated. Example (`apps/web/lib/assistant/tools/create-study-draft.ts`):

```ts
import { tool } from "ai";
import { withWorkspaceAccessControl } from "../access-control";
import { metadata } from "./create-study-draft.metadata";

export const createStudyDraft = tool({
  description: metadata.description,
  inputSchema: CreateStudyDraftInputSchema,
  execute: withWorkspaceAccessControl(
    "createStudyDraft",
    metadata,  // metadata.requiredScopes = ["study:editor"]
    async (input, ctx) => {
      // ... existing body ...
    },
  ),
});
```

PostHog reference: `/home/jia/posthog/ee/hogai/README.md` § Access control (resource-level + object-level pattern) and the `MaxTool.get_required_resource_access()` API. We **don't** borrow the LangChain `BaseTool` inheritance; we keep AI SDK 6 `tool()` and bolt access control on top.

## REQ-5 design: Mandatory skill table

Add this section to root `AGENTS.md`, right after the existing `### Intent → Skill mapping` table:

```markdown
### Mandatory skill invocation

**Always invoke** before the first non-trivial edit in a session:

| Touch this | Invoke this skill |
|---|---|
| `packages/contracts/src/*.ts` | `spec-driven-development` + `pre-implementation` |
| `apps/functions/*/src/handler.ts` | `incremental-implementation` + `test-driven-development` |
| `apps/agent/agent/interview/{workflow,supervisor,engine}.py` | `diagnose` (hot path) |
| `.github/workflows/*.yml` | `ci-cd-and-automation` |
| `apps/web/lib/assistant/tools/*.ts` | `api-and-interface-design` (Morris tool surface is a public contract) |
| `apps/web/components/**/*.tsx` (new component) | `frontend-ui-engineering` |
| `docs/adr/*.md` (new ADR) | `documentation-and-adrs` |

**Invoke when in the area** (softer triggers):

| Activity | Invoke this skill |
|---|---|
| Investigating a bug | `debugging-and-error-recovery` |
| Reviewing a PR | `code-review-and-quality` |
| Refactoring without behavior change | `code-simplification` |
| Performance work | `performance-optimization` |
| Security review | `security-and-hardening` |
| Pre-launch / deploy | `shipping-and-launch` |

**Skill gaps** (referenced above but not present in `~/.agents/skills/` today — track here so we don't silently invent them):

- (none currently)

If a skill in the **Always invoke** table is not loaded before the change, the PR description's "Agent context" line MUST explain why.
```

CI guard: `.github/workflows/ci.yml` gets a tiny step `grep -q 'Mandatory skill invocation' AGENTS.md` so the section can't be silently removed.

## Cross-cutting concerns

### Observability for every new surface

- **REQ-1 (semgrep)**: Findings go to GHA annotations + non-zero exit. No runtime observability.
- **REQ-2 (husky)**: stderr only — local UX, not logged.
- **REQ-3 (health)**: per-check failures log at `debug` level (probes happen every few seconds; `info` would flood logs). Successful probes log nothing. Slow checks log at `warn` if > 1s.
- **REQ-4 (Morris ACL)**: every denial emits `morris.tool.access_denied` at `info`. Sample rate is intentionally 100% — these are security events worth keeping.
- **REQ-5 (AGENTS table)**: no runtime artifact, doc-only.

### Secret handling

- Health endpoints MUST NOT include any value derived from env. Response is `{ http: true }` / `{ appwrite: true, livekit: false }` — booleans only.
- Semgrep `no-secret-in-source` rule's exception list is `.env.example` patterns only.
- Morris ACL never echoes the workspace member's role to the client (generic copy on denial).

### Test discipline

Per `testing.md` four-layer model, every Wave A requirement gets:

| Requirement | Unit | Property | Integration w/ fakes | Live |
|---|---|---|---|---|
| REQ-1 (semgrep) | Each rule has positive + negative fixtures | n/a (no runtime invariants) | `pnpm semgrep` on a synthetic repo subset | n/a |
| REQ-2 (husky) | n/a (shell scripts) | n/a | manual: commit a tainted file, verify reject | n/a |
| REQ-3 (health) | Each check function with in-memory deps | "single dep down → 503", "all up → 200" | hit `/_readyz` against Docker stack | `MERISM_LIVE_TESTS=1 pnpm test:properties` adds drain transition test |
| REQ-4 (Morris ACL) | Wrapper, each scope check | "member can't editor", "cross-workspace always denies" | tool execution test with fake session | optional — gated |
| REQ-5 (AGENTS table) | grep-presence test in CI | n/a | n/a | n/a |

## Alternatives considered (rejected)

| Alternative | Why rejected |
|---|---|
| ESLint custom rules instead of semgrep | ESLint cross-file taint (e.g., "this token appears in two files") is awkward; semgrep is built for it. Steering already references semgrep-style checks; matching the pattern reduces cognitive load. |
| OPA / Rego for Morris ACL | Overkill; we have 3 roles + 4 resources. A typed TS map is auditable + IDE-completable. Revisit if scopes ever exceed ~30. |
| Adopt tach as Python module enforcer | Python surface is one Worker (apps/agent) — too small to justify tach's setup. Keep enforcement in `import` rules + steering. Apps/web (TS) gets dependency-cruiser in Wave B (REQ-6). |
| Replace Morris with LangChain `MaxTool` | Conflicts with ADR-0002 (Vercel AI SDK 6 ToolLoopAgent). We borrow the **policy shape**, not the controller. |
| Run evals on every PR | Token cost + latency. PostHog runs evals nightly via CI. Match that cadence (REQ-7 Wave B). |
| Block on resource limit hits (PostHog only emits events) | Already documented split: notify-only for soft limits, throw `429 too_many_resources` for abuse vectors. REQ-8 design covers both paths. |
| Adopt Braintrust / LangSmith for eval upload | External SaaS — conflicts with `errors-and-observability.md` § Sink rule (no external POST sinks). Local JSON + logger sink covers our scale. |
| `tach` for Python in addition to dependency-cruiser for TS | One worker process doesn't need import-graph enforcement; cost > benefit. |

## Upstream references (PostHog file paths cited above)

For verification per `pre-implementation.md`:

| Topic | PostHog path |
|---|---|
| Semgrep rules + tests | `/home/jia/posthog/.semgrep/rules/` |
| Husky pre-commit / pre-push | `/home/jia/posthog/.husky/{pre-commit,pre-push}` |
| Health endpoints + drain | `/home/jia/posthog/posthog/health.py` |
| MaxTool access control pattern | `/home/jia/posthog/ee/hogai/README.md` § Access control |
| AGENTS.md mandatory skill table | `/home/jia/posthog/AGENTS.md` § Mandatory skill invocation |
| Resource limits registry (Wave B) | `/home/jia/posthog/posthog/resource_limits/{registry,evaluator}.py` |
| AI eval CI structure (Wave B) | `/home/jia/posthog/ee/hogai/eval/ci/`, `/home/jia/posthog/ee/hogai/eval/scorers/` |
| Prompt versioning / playground (Wave B) | `/home/jia/posthog/products/ai_observability/frontend/{playground,prompts}/` |
| Module boundary (Wave B) | `/home/jia/posthog/tach.toml`, `/home/jia/posthog/pyproject.toml` (import-linter section) |

## Data flow sketch (for the PR description per `pre-implementation.md`)

```
REQ-1 Semgrep
  developer  →  edit code  →  git commit
                                │
                                ▼
                       husky pre-commit (REQ-2)
                                │   lint-staged + scope-guard
                                ▼
                            git push (REQ-2 pre-push: not main)
                                │
                                ▼
                        CI: semgrep + tests + typecheck + scope-guard
                                │
                                ▼
                              merge

REQ-3 Health
  k8s livenessProbe → /_livez → 200 always (until JS heap dead)
  k8s readinessProbe → /_readyz?role=web → check Appwrite + cache → 200|503
  k8s preStop → touch $PRESTOP_MARKER → /_readyz returns 503 → traffic drained
  SIGTERM → agent worker finishes in-flight rooms → exit

REQ-4 Morris ACL
  user msg → AI SDK ToolLoopAgent → picks tool X
                                          │
                                          ▼
                            withWorkspaceAccessControl(X, metadata, body)
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                       scope check              resource check
                       (role → scopes)          (resource.workspaceId === session.workspaceId)
                              │                       │
                              └───────────┬───────────┘
                                          ▼
                                     body() runs    OR    return tool-error message
```
