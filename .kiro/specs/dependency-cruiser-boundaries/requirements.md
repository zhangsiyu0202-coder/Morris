# Sub-spec: `dependency-cruiser-boundaries`

> **Status**: stub (requirements drafted; design + tasks pending scheduling).
> **Parent spec**: `.kiro/specs/robustness-hardening/` (Wave B REQ-6)
> **Created**: 2026-06-30, scheduled as Wave B during robustness-hardening planning.

## Motivation

`architecture.md` defines a module map — Contracts / Functions / Agent / Web / Observability /
Schema — with explicit "MUST NOT" import rules per row. Today these rules are:

- Reviewed by humans at PR time, and
- Spot-checked by semgrep AST patterns for narrow cases (`handler-no-sdk-import.yaml`).

Both are incomplete. Semgrep can catch "this file imports that symbol", but it can't model
**transitive** module relationships, and it doesn't have a native notion of "this module
boundary". Dependency-cruiser does — it builds the actual dependency graph from `import` /
`require` / dynamic imports and lets you encode forbidden edges declaratively.

PostHog uses dependency-cruiser for their `products/` boundary enforcement (one product can't
import another product's internals; both can import from `posthog/`). MerismV2 has the same
shape: `apps/web` modules can import `packages/contracts`, but `apps/functions/issueLivekitToken`
must NOT import `apps/web/lib/*`. Today this is a review-only rule. Cruiser makes it mechanical.

## Requirements

### REQ-1: Encode the architecture module map as a cruiser config

**WHAT**: a `.dependency-cruiser.json` (or `.cjs` for comments) at the repo root that declares,
at minimum, these forbidden edges (mirrors `architecture.md` § Module map):

1. `apps/functions/**` → `apps/web/**` (Functions are server-side, must not pull web code).
2. `apps/web/**` → `apps/functions/**/src/**` (web should call Functions via HTTP, not import them).
3. `apps/web/lib/assistant/tools/**` → `node-appwrite` / `appwrite` (must go through `lib/server/*`).
4. `packages/contracts/src/**` → any runtime SDK (`node-appwrite`, `livekit-server-sdk`,
   `livekit-agents`, etc. — contracts are zero-dependency).
5. `packages/observability/src/**` → `@merism/contracts` (observability is even more foundational
   than contracts; this prevents circular deps).
6. `apps/agent/agent/interview/**` → `livekit_agents` top-level import (must be lazy/conditional).
   Note: cruiser is JS-only; Python rule mirror lives in a sibling sub-spec or stays as an
   agent-level test.

**Acceptance**: `pnpm deps:cruise` runs `depcruise --config .dependency-cruiser.cjs apps packages`
and prints 0 violations on the current tree.

### REQ-2: CI integration

**WHAT**: a new CI job `dependency-cruiser` in `.github/workflows/ci.yml` with
`timeout-minutes: 3` that runs `pnpm deps:cruise`. Backwards-compat per AGENTS.md CI guardrails:
additive job, no env/step changes to existing jobs.

**Acceptance**: a deliberately-introduced forbidden import (e.g., `apps/web/lib/example.ts`
importing from `apps/functions/issueLivekitToken/src/deps.ts`) fails the CI job with a
human-readable violation message.

### REQ-3: Reconcile overlap with semgrep

**WHAT**: where a rule is expressible both ways (e.g., REQ-3 above overlaps with future semgrep
"no SDK import in tools"), document the layering in `.dependency-cruiser.cjs` comments and in
`.semgrep/README.md`. Default: cruiser handles module-level imports; semgrep handles in-file
patterns. The same rule MUST NOT live in both layers — pick one and reference it.

**Acceptance**: no semgrep rule and cruiser rule fire on the same violation. A grep of
`.semgrep/rules/*.yaml` and `.dependency-cruiser.cjs` shows no duplicated edge.

### REQ-4: Visualization

**WHAT**: a `pnpm deps:graph` script that runs `depcruise ... --output-type dot |
dot -T svg > docs/architecture/module-graph.svg`, committed and regenerated on architecture
changes. Bonus: cruiser supports archi / matrix output for high-level views.

**Acceptance**: the SVG exists, renders, and matches the module map in `architecture.md` §
Module map. Updating the cruiser config in the same PR regenerates the SVG.

## Out of scope

- Python boundary enforcement (`apps/agent/`). Cruiser is JS-only. A Python equivalent (e.g.,
  import-linter, or pytest test inspecting `sys.modules`) belongs in a follow-up.
- Cross-package version drift (one package imports another at a stale version). That's
  pnpm's `workspace:*` problem, not cruiser's.
- Detecting unused exports / dead code. Different problem; covered by `ts-prune` or `knip`
  in a future tooling spec.

## Open questions (to resolve during design)

1. **Layer of enforcement**: pure CI gate, or also a pre-build step that runs locally? CI gate
   is simpler; local pre-build catches errors earlier but adds friction. Default to CI gate.
2. **`apps/agent`**: cruiser can scan Python via plugins, but our agent is `uv`-managed and the
   Python plugin ecosystem is weaker. Decide whether to scope this sub-spec to JS only and file
   a sibling Python boundary sub-spec, or attempt the unified approach.
3. **Tests folder**: should `**/__tests__/**` and `**/*.test.ts` be allowed to import anything
   (production-only edges are the strict ones)? Yes — tests routinely cross boundaries to set
   up scenarios. Cruiser supports `from.path` exclusions for this.
4. **Auto-generated SVG cadence**: committed once and updated manually, or generated on every
   PR via CI? Manual is cleaner; auto-generation creates merge conflicts.

## Scheduling notes

- **Estimated wave size**: medium. Config is small (~100 lines), but reconciliation with semgrep
  and Python sibling will take design discussion.
- **Trigger to flesh out**: when a new module boundary is introduced (e.g., a 5th app under
  `apps/`) or when a review catches a real forbidden import that semgrep missed.
- **Pre-reqs**: `lint-baseline-cleanup` (clean baseline first so cruiser doesn't ship with a
  parallel baseline of pre-existing violations).
- **Estimated effort**: 1-2 days; mostly config writing + finding existing violations + deciding
  how to fix or grandfather them.
- **Sequencing**: AFTER `lint-baseline-cleanup`; can run in parallel with `ai-eval-suite`
  (different surfaces).

## References

- Parent spec: `.kiro/specs/robustness-hardening/{requirements,design,tasks}.md` REQ-6
- Steering: `.kiro/steering/architecture.md` § Module map + Globally forbidden
- ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md`
- PostHog reference: `~/posthog/.dependency-cruiser.cjs` (their products/ boundary config)
- Cruiser docs: https://github.com/sverweij/dependency-cruiser
