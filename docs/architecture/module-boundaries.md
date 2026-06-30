# Module boundaries

> Companion to `.kiro/steering/architecture.md` § Module map and
> `.semgrep/README.md` § Rules. This doc covers the module-graph layer.

## Two layers of enforcement

| Layer | Tool | Catches |
|---|---|---|
| **File-content** | `semgrep` (`.semgrep/rules/`) | AST patterns inside a single file (e.g., "this file imports SDK", "this file uses `console.log`") |
| **Module-graph** | `dependency-cruiser` (`.dependency-cruiser.cjs`) | Relationships between modules (e.g., "Function code may not import web code", "Morris tools may not cross-import siblings") |

The same rule MUST NOT live in both layers — duplicate enforcement
creates two failure modes for the same violation. Where there's overlap
potential (e.g., "Morris tools can't import SDK"), pick the layer that's
more natural and document the choice in both configs.

## Rule catalog

See `.dependency-cruiser.cjs` for the authoritative list. Summary:

| Rule | Severity | Catches |
|---|---|---|
| `functions-no-web-import` | error | `apps/functions/**` importing `apps/web/**` |
| `web-no-function-internals` | error | `apps/web/**` importing `apps/functions/*/src/**` (one allowed exception: dev-issue-token fallback) |
| `morris-tools-no-sdk-import` | error | `apps/web/lib/assistant/tools/**` importing Appwrite / LiveKit SDK |
| `contracts-no-runtime-sdk` | error | `packages/contracts/` taking a runtime SDK dep |
| `observability-no-contracts-import` | error | `packages/observability/` importing contracts |
| `no-cross-tool-import` | error | A Morris tool importing a sibling Morris tool directly |
| `no-circular` | error | Any circular import cycle |

Each rule's `comment` in the config explains the *why* and links back to
steering.

## Commands

```bash
pnpm deps:cruise           # CI gate; exits non-zero on any error-severity violation
pnpm deps:cruise:report    # Same, writes a JSON report to deps-cruise-report.json
pnpm deps:graph            # Regenerate docs/architecture/module-graph.svg (requires graphviz)
```

`deps:graph` needs the `dot` command from graphviz. Install locally with
`brew install graphviz` / `apt install graphviz`. Not on CI — the SVG is
regenerated manually when the module map materially changes.

## Adding a new boundary rule

1. Pick a `name` of the form `<area>-<intent>` (e.g.,
   `analytics-no-direct-write`).
2. Add a `forbidden` entry in `.dependency-cruiser.cjs` with `severity:
   "error"`, `from.path`, `to.path`, and a `comment` linking to the
   relevant steering doc / ADR.
3. Run `pnpm deps:cruise` locally. If existing code violates the new
   rule, decide: fix the violations OR bump severity to `"warn"` and
   open a baseline-cleanup sub-spec (mirroring the
   `.kiro/specs/lint-baseline-cleanup/` pattern).
4. Update this doc's catalog table.
5. Open the PR. CI's `dep-cruiser` job gates the change.

## Adding a new module / app

A new `apps/<thing>/` or `packages/<thing>/` directory does NOT
automatically pick up any boundary rule. Author the rule in the same PR.
If you forget, no rule = no enforcement on the new module's imports
until someone notices in review.

(Future enhancement: a property test asserting every `apps/*/` and
`packages/*/` is covered by at least one cruiser `from.path` rule. Cost
< benefit at today's scale; revisit at ≥ 8 modules.)

## Allowed exception pattern

When a single file legitimately violates a boundary rule (e.g., the
dev-issue-token fallback path), encode the exception as `pathNot` on the
`from` block — NEVER as a blanket `--exclude` flag at invocation time
(that's lossy and undocumented).

Example from `web-no-function-internals`:

```js
from: {
  path: "^apps/web/",
  pathNot: "^apps/web/app/api/dev-issue-token/route\\.ts$",
},
```

The `pathNot` regex IS the audit trail — anyone reading the config sees
exactly which files are exempt and can grep the steering for the
rationale.

If the exception list grows beyond 1-2 entries per rule, the rule is
probably wrong; rethink rather than expand.

## References

- Steering: `.kiro/steering/architecture.md` § Module map + Globally forbidden
- Sister doc: `.semgrep/README.md` (file-content-pattern layer)
- Sub-spec: `.kiro/specs/dependency-cruiser-boundaries/`
- ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md`
- Cruiser docs: https://github.com/sverweij/dependency-cruiser
