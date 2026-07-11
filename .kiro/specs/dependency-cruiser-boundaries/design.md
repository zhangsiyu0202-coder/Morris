# Design: `dependency-cruiser-boundaries`

> **Parent**: `.kiro/specs/dependency-cruiser-boundaries/requirements.md`
> **Date**: 2026-06-30
> **Status**: design complete.

## Open question resolutions

### Q1 — Layer of enforcement: **CI gate primary, opt-in local script**

CI gate is the binding enforcement. Locally, `pnpm deps:cruise` exists but is
not on a pre-commit hook (we explicitly rejected husky in
`docs/adr/0012-borrow-engineering-practices-from-posthog.md`). A developer
who runs `pnpm test && pnpm typecheck && pnpm scope-guard && pnpm semgrep`
locally before pushing should add `pnpm deps:cruise` to that list — it's
fast (< 3s on the current tree) so the cost is trivial.

Reasoning: dep-cruiser violations are 100% mechanical — there's no judgment
call about whether a forbidden edge is "okay this time". The rule either
applies or it doesn't. CI gate is the right surface.

### Q2 — Python boundary in `apps/agent/`: **out of scope for this sub-spec; file a sibling later if needed**

Cruiser is JS-only. Python equivalents (`import-linter`,
`tach`, `pyright --strict-mode --module-imports`) all exist but bring their
own learning curve + maintenance. The Python boundary today is small:

- `apps/agent/agent/interview/*.py` MUST NOT top-level import livekit-agents
  (lazy import only). Already tested by `apps/agent/tests/test_lazy_import.py`.
- `apps/agent/agent/persistence/*.py` MUST NOT import from
  `apps/agent/agent/interview/*` (one-way realtime → persistence flow).
  Today this is enforced by reviewer.

Adding a third tool for a 2-rule Python boundary is overhead. Defer; revisit
if the Python module map grows to ≥ 5 rules.

### Q3 — Tests folder allowed to cross boundaries: **YES, by convention**

Tests legitimately need to import production internals to set up fixtures
and assertions. Cruiser config will use `from.path` exclusions for:

- `**/__tests__/**`
- `**/*.test.{ts,tsx}`
- `**/tests/**` (e.g., `apps/functions/*/tests/`)
- `tests/properties/**` (cross-package property tests)
- `tests/evals/**` (Wave B AI eval harness, when it lands)

Tests are NOT exempt from `to.path` rules though — i.e., a test file CAN
import a Function's handler, but the test itself cannot be imported BY a
Function. Direction matters.

### Q4 — Auto-generated SVG cadence: **manual, opt-in**

Auto-regen on every PR creates merge conflicts on `docs/architecture/module-graph.svg`.
Local `pnpm deps:graph` is enough; commit when the module map changes
materially (new module added, edge added/removed). Same cadence as
updating `architecture.md` § Module map.

Default SVG cadence: regenerate after every accepted change to
`.dependency-cruiser.cjs`. The PR description should mention the regen if
the graph changed.

## Architecture

### Boundary rules to encode (initial cut)

Maps `architecture.md` § Module map "MUST NOT" column to cruiser
`forbidden` rules. Each rule has a `name` (referenced in violation
messages), a `from.path` glob, a `to.path` glob, and an optional `comment`.

```js
// .dependency-cruiser.cjs (shape; final config in implementation phase)
module.exports = {
  forbidden: [
    {
      name: 'functions-no-web-import',
      from: { path: '^apps/functions/' },
      to:   { path: '^apps/web/' },
      comment: 'Functions are server-side; they MUST NOT import web client code. ' +
               'See architecture.md § Module map.',
    },
    {
      name: 'web-no-function-internals',
      from: { path: '^apps/web/' },
      to:   { path: '^apps/functions/.+/src/' },
      // NOTE: importing types from a Function's src/ is allowed via
      // packages/contracts/, not direct. dev-issue-token route is the
      // ONE exception today; handled via pathNot below.
      pathNot: '^apps/web/app/api/dev-issue-token/route\\.ts$',
      comment: 'Web should call Functions via HTTP, not import their internals. ' +
               'Dev fallback route at apps/web/app/api/dev-issue-token/ is the ' +
               'sole exception (per docs/dev/deploy-functions.md fallback path).',
    },
    {
      name: 'morris-tools-no-sdk-import',
      from: { path: '^apps/web/lib/assistant/tools/' },
      to:   { path: 'node-appwrite|^appwrite$|livekit-server-sdk' },
      // Morris tools go through @/lib/server/* helpers, never SDK directly.
      // Mirrors the architectural rule that handler.ts can't import SDK
      // (already enforced by semgrep handler-no-sdk-import.yaml).
      comment: 'Morris tools must use @/lib/server/* helpers, not SDK directly. ' +
               'See AGENTS.md § Morris 工具集 + architecture.md § Module map.',
    },
    {
      name: 'contracts-no-runtime-sdk',
      from: { path: '^packages/contracts/' },
      to:   { path: 'node-appwrite|^appwrite$|livekit-server-sdk|livekit-client' },
      comment: 'Contracts is zero-dependency by design; only zod + std. ' +
               'See contracts.md § Source-of-truth rule.',
    },
    {
      name: 'observability-no-contracts-import',
      from: { path: '^packages/observability/' },
      to:   { path: '^@merism/contracts$|^packages/contracts/' },
      comment: 'Observability is more foundational than contracts; importing ' +
               'contracts would create a circular dep when contracts adds a ' +
               'log emission (which it should not, but the boundary is ' +
               'belt-and-suspenders).',
    },
    {
      name: 'no-cross-tool-import',
      from: { path: '^apps/web/lib/assistant/tools/([^/]+)\\.ts$' },
      to:   { path: '^apps/web/lib/assistant/tools/(?!\\1)([^/]+)\\.ts$' },
      // capture-group trick: tools/A.ts can't import tools/B.ts; only
      // through shared helpers in lib/assistant/.
      comment: 'Morris tools are siblings; cross-tool imports indicate a missing ' +
               'shared helper. Lift the shared piece to lib/assistant/.',
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.base.json' }, // resolve @/ alias
    exclude: {
      path: [
        'node_modules',
        'dist',
        '\\.next',
        'coverage',
        '\\.semgrep',
        '\\.kiro',          // specs and steering, not code
        '__mocks__',
      ],
    },
    doNotFollow: { path: 'node_modules' },
    moduleSystems: ['amd', 'cjs', 'es6', 'tsd'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
```

The `name` of each forbidden rule is what appears in the violation message.
Names follow `<area>-<intent>` so failures are self-describing.

### Overlap with semgrep (REQ-3 of requirements.md)

| Rule | Cruiser | Semgrep | Justification |
|---|---|---|---|
| Handler must not import SDK | — | `handler-no-sdk-import.yaml` | Semgrep matches the import statement AST in a single file; cruiser would need fragile path matching. Stay in semgrep. |
| Functions can't import web | `functions-no-web-import` | — | Module-graph relationship; cruiser idiom. |
| Web can't import function internals | `web-no-function-internals` | — | Same reason; cruiser idiom. Exception (`dev-issue-token`) is encoded as `pathNot`. |
| Morris tools can't SDK-import | `morris-tools-no-sdk-import` | — | Cross-file: which files are "tools" is path-defined. Cruiser idiom. |
| Contracts no SDK dep | `contracts-no-runtime-sdk` | — | Module-graph; cruiser idiom. |
| Tools can't cross-import siblings | `no-cross-tool-import` | — | Path regex capture; cruiser idiom (semgrep can't capture and back-reference across files). |
| No silent catch fallback | — | `no-silent-catch-fallback.yaml` | Pattern in a single file; semgrep idiom. |
| No bare console | — | `no-bare-console-in-source.yaml` | Same; semgrep idiom. |
| No secret literal | — | `no-secret-in-source.yaml` | Same; semgrep idiom. |

**Convention**: cruiser owns "module A may not import module B" (graph
shape); semgrep owns "this AST pattern is forbidden in source X" (file
content). Same rule MUST NOT appear in both layers — duplicate enforcement
creates two failure modes for the same violation and confuses the
reviewer. `.semgrep/README.md` + `.dependency-cruiser.cjs` comments
cross-reference each other.

### CI integration

A new `dependency-cruiser` job in `.github/workflows/ci.yml`:

```yaml
dependency-cruiser:
  name: dep-cruiser
  runs-on: ubuntu-latest
  timeout-minutes: 3
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with: { version: 10 }
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm deps:cruise
```

Additive job (per AGENTS.md § CI guardrails), `timeout-minutes: 3`, no env
changes to existing jobs. `pnpm deps:cruise` exits non-zero on any
violation — same gate semantics as `pnpm semgrep`.

### Local commands

```bash
pnpm deps:cruise           # CI gate; exits non-zero on any violation
pnpm deps:cruise:report    # Same, but writes a JSON report to deps-cruise-report.json
pnpm deps:graph            # Regenerate docs/architecture/module-graph.svg (requires graphviz)
```

`deps:graph` requires the `dot` command from graphviz. We don't add
graphviz to CI (the SVG is regenerated manually per Q4); developers who
need it install graphviz locally (`brew install graphviz` /
`apt install graphviz`).

## Risks

1. **`pathNot` for `dev-issue-token`**: this exception encodes that ONE
   web file legitimately imports a Function's handler (the dev-only
   fallback path). If the exception list grows beyond 1-2 entries, the
   boundary rule is wrong and needs rethinking. Today's count: 1. Cap
   at 3 in a code review.

2. **`tsconfig.base.json` alias resolution**: cruiser uses TS-aware
   resolution. If the `@/` alias resolution drifts (e.g.,
   `apps/web/tsconfig.json` overrides `paths` differently from
   `tsconfig.base.json`), cruiser might miss-classify a file. Verified
   during implementation: cruiser sees the same module graph as `tsc`.

3. **New module added without cruiser update**: a new `apps/<thing>/`
   directory wouldn't be subject to any forbidden rule by default —
   it'd be free to import anything. Mitigation: a smoke test in
   `tests/properties/module-boundaries.test.ts` (or a cruiser feature
   if one exists) that asserts every `apps/*/` and `packages/*/`
   directory has at least one cruiser rule with `from.path` matching it.
   Defer to follow-up if it ever bites.

4. **Cruiser's own version drift**: `dependency-cruiser` major versions
   sometimes change rule schema. Pin the version in `package.json` (no
   range) and update deliberately.

## References

- Parent spec: `.kiro/specs/dependency-cruiser-boundaries/requirements.md`
- Steering: `.kiro/steering/architecture.md` § Module map + Globally forbidden
- PostHog reference: `~/posthog/.dependency-cruiser.cjs` (their products/ boundary config)
- Cruiser docs: https://github.com/sverweij/dependency-cruiser
- Sister doc: `.semgrep/README.md` (the file-content-pattern layer)
