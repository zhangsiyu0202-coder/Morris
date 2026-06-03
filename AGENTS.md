# MerismV2 Agent Instructions

## Project Context

MerismV2 is an AI-driven voice interview qualitative research platform. The intended architecture is:

- Researcher web app: Next.js App Router + TypeScript + Tailwind + shadcn/ui.
- Realtime interview layer: LiveKit server + Python LiveKit Agent Worker.
- Interview orchestration: LiveKit Supervisor / TaskGroup / AgentTask workflow hosted inside the agent worker. LangGraph is no longer the primary controller for the realtime voice interview module.
- Page assistant: CopilotKit runtime and UI for survey editing workflows.
- Backend single source of truth: self-hosted Appwrite for Auth, Database, Storage, Realtime, and Functions.
- Shared contracts: `packages/contracts` is the TypeScript/zod source for cross-module API and data shapes; Python mirrors only the agent-needed subset in `apps/agent/agent/contracts.py`.

The product is for qualitative voice interviews: survey design, anonymous interview links, realtime AI voice interviews, transcripts/recordings, and structured analysis reports.

## Hard Architecture Rules

- Keep modules low-coupled and high-cohesion. Do not let UI, Appwrite schema tooling, LiveKit agent workflow code, analysis code, and CopilotKit tools bleed into each other.
- Treat `packages/contracts` as the stable boundary between modules. Update contracts first when changing cross-module data, then update consumers.
- Keep realtime interview state and media inside LiveKit Agents workflows. Do not route realtime media or turn-by-turn state through Appwrite unless the spec explicitly calls for persistence.
- Keep Appwrite as the only backend platform unless a later architecture decision explicitly changes this.
- Keep anonymous interviewees accountless. Interviewee access must go through dedicated server functions such as `issueLivekitToken`; do not give anonymous clients direct collection write access.
- Do not add multi-user collaboration, teams, sharing, comments, billing, subscriptions, quotas, plans, seats, or usage-metering concepts. They are out of scope by architecture.
- Never expose provider secrets, Appwrite API keys, or LiveKit API secrets in client code, logs, test snapshots, build output, or response bodies.

## Coding Standards

- Prefer small, cohesive modules with explicit interfaces over broad service objects.
- Prefer structured schemas and typed contracts over ad hoc object/string handling.
- Use mature ecosystem patterns from the active stack before inventing custom infrastructure:
  - LiveKit Agents examples for agent lifecycle, room metadata, track handling, interruption/barge-in patterns, Supervisor pattern, TaskGroup, and AgentTask.
  - CopilotKit examples for tool/action definitions and runtime integration.
  - Appwrite Server SDK examples for functions, permissions, storage buckets, and schema operations.
- Keep hot-path interview code performance-conscious: avoid unnecessary network calls, avoid shared mutable global state across sessions, and isolate per-session state.
- Use explicit error types for provider failures and preserve `traceId` in logs/responses where applicable.
- Add comments only when they explain non-obvious decisions or invariants.
- Default to ASCII in source files unless the existing file already uses Chinese or other Unicode prose.

## Repository Map

- `.kiro/specs/foundation-setup/requirements.md`: foundation requirements and acceptance criteria.
- `.kiro/specs/foundation-setup/design.md`: architecture baseline, topology, data model, and sub-spec boundaries.
- `.kiro/specs/foundation-setup/tasks.md`: foundation implementation plan and dependency waves.
- `packages/contracts`: zod schemas and TypeScript types for entities, API contracts, and shared interview workflow state.
- `packages/observability`: TypeScript logger, retry, and function error-boundary helpers.
- `apps/agent`: Python LiveKit Agent Worker skeleton and pydantic contract mirrors.
- `infra/docker/docker-compose.yml`: local Appwrite + LiveKit stack.
- `scripts`: stack, environment, and Python test helpers.
- `tests/properties`: property-based test templates.

Current skeleton gaps to respect when planning work:

- `apps/web` is referenced by scripts/specs but is not present yet.
- `apps/functions/issueLivekitToken` is planned but not present yet.
- `packages/appwrite-schema` currently has package metadata but no `src/` implementation.
- Root `smoke` and `e2e` scripts reference planned files that may not exist yet.

## Common Commands

- Install JS dependencies: `pnpm install`.
- Build all packages with build scripts: `pnpm build`.
- Typecheck all packages with typecheck scripts: `pnpm typecheck`.
- Run TypeScript tests: `pnpm test`.
- Run property tests: `pnpm test:properties`.
- Run Python agent tests from root: `pnpm test:py`.
- Run Python tests directly: `cd apps/agent && uv run pytest`.
- Start local infra: `pnpm stack:up`.
- Stop local infra without deleting volumes: `pnpm stack:down`.
- Reset local infra volumes: `pnpm stack:reset`.
- Run agent with realtime deps: `cd apps/agent && uv sync --extra realtime && uv run python -m agent.main dev`.

Before running commands that require Docker, network access, or dependency downloads, expect that sandbox approval may be needed.

## Testing Expectations

- For contract changes, run `pnpm -F @merism/contracts typecheck` and related tests.
- For observability changes, run `pnpm -F @merism/observability typecheck` and related tests.
- For Python agent changes, run `pnpm test:py` or `cd apps/agent && uv run pytest`.
- For Appwrite/LiveKit integration changes, prefer tests against the local Docker stack and keep credentials in `.env`, never committed.
- Add or update property-based tests for permission, token, secret-leakage, state-machine, and concurrency invariants when touching those areas.

## Design Workflow

- Read the relevant foundation spec before implementing a new module.
- For new cross-module behavior, define the contract in `packages/contracts` first.
- For Python agent behavior that depends on contracts, mirror only the necessary schema in `apps/agent/agent/contracts.py` and keep field names aligned with zod schemas.
- For realtime voice interviews, model the conversation with a long-lived LiveKit supervisor agent, ordered `TaskGroup`s for sections/blocks, and focused `AgentTask`s for reusable collection or interview tasks. Do not introduce LangGraph as the main realtime interview controller unless the architecture is explicitly revised again.
- For Appwrite schema and permissions, keep declaration, apply, and verify logic idempotent and non-destructive by default.
- For frontend work, build the actual workflow surface, not marketing pages. Use existing design-system conventions once `apps/web` exists.
- For AI or provider integrations, keep provider adapters behind narrow interfaces. All LLM calls use DeepSeek; Qwen is reserved for ASR/TTS unless a future ADR changes this.

## Scope Guard

Do not introduce fields, collections, functions, UI, dependencies, or docs that imply:

- teams or organizations,
- collaborative editing,
- sharing/commenting,
- billing/subscriptions,
- quotas/plans/seats,
- usage metering.

If a future request appears to require one of these, stop and ask for an explicit architecture update rather than implementing it implicitly.
