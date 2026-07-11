# Tasks: `dependency-cruiser-boundaries`

> **Parent**: `.kiro/specs/dependency-cruiser-boundaries/{requirements,design}.md`
> Single PR (~1-2 days). Tasks are intra-PR work units.

## Phase A — install + scaffold

- **A.1** Add `dependency-cruiser` as a pinned dev dep at the workspace root:
  ```bash
  pnpm add -Dw dependency-cruiser@<latest-stable>
  ```
  Use exact version (no `^` range) per AGENTS.md § Dependency hygiene.

- **A.2** Write `.dependency-cruiser.cjs` at repo root with the 6 forbidden
  rules from `design.md § Architecture`. Use `name` / `from` / `to` /
  `comment` shape per cruiser docs. Include `options.tsConfig.fileName =
  "tsconfig.base.json"` so the `@/` alias resolves.

- **A.3** Add 3 pnpm scripts to root `package.json`:
  ```json
  "deps:cruise": "depcruise --config .dependency-cruiser.cjs apps packages",
  "deps:cruise:report": "depcruise --config .dependency-cruiser.cjs --output-type json apps packages > deps-cruise-report.json",
  "deps:graph": "depcruise --config .dependency-cruiser.cjs --output-type dot apps packages | dot -T svg > docs/architecture/module-graph.svg"
  ```
  `deps:graph` is opt-in and requires local graphviz; document in README.

**Acceptance**: `pnpm deps:cruise` runs to completion. (May exit non-zero
on baseline violations — that's Phase B's problem.)

## Phase B — baseline triage

- **B.1** Run `pnpm deps:cruise` and capture the full violation list.
  Expected baseline: ~0 violations because the existing code already
  honors the boundaries (semgrep + scope-guard already enforce most of
  these at the file level). If 1-5 violations surface:

  1. For each violation, decide: (a) genuine bug — fix the import,
     (b) intentional exception — encode in cruiser config as `pathNot`,
     (c) rule too strict — tighten the rule pattern.
  2. Document each exception with a comment in `.dependency-cruiser.cjs`.

  If > 5 violations surface, the baseline is too noisy for ERROR severity;
  drop to WARNING in cruiser config (cruiser supports per-rule severity)
  and file a `dep-cruiser-baseline-cleanup` follow-up sub-spec — mirroring
  the semgrep baseline pattern.

**Acceptance**: `pnpm deps:cruise` exits 0 on the current tree.

## Phase C — CI integration

- **C.1** Add `dependency-cruiser` job to `.github/workflows/ci.yml`
  (additive, per design.md § CI integration). `timeout-minutes: 3`.

- **C.2** Verify CI compatibility:
  - Job runs on the same `ubuntu-latest` + Node 22 + pnpm 10 matrix as
    other CI jobs.
  - Cache pnpm store via `actions/setup-node@v4` (already pattern-aligned).
  - Job does NOT modify env vars for existing jobs (backwards-compat).

**Acceptance**: workflow YAML is valid (`actionlint` or
`pnpm dlx @action-validator/cli ./github/workflows/ci.yml` if available)
and the job invokes `pnpm deps:cruise`.

## Phase D — documentation + visualization

- **D.1** Write `docs/architecture/module-boundaries.md` (~50 lines)
  explaining: (a) what cruiser does, (b) how to add a new boundary rule,
  (c) how to test boundary rules locally, (d) the cruiser-vs-semgrep
  convention. Mirrors `.semgrep/README.md` shape.

- **D.2** Run `pnpm deps:graph` locally (requires graphviz installed) to
  generate `docs/architecture/module-graph.svg`. Commit the SVG.
  Document in `docs/architecture/module-boundaries.md` how to regenerate.

- **D.3** Update `AGENTS.md` § Automation hierarchy: add `pnpm deps:cruise`
  to the CI-checks list right after `pnpm semgrep`. Add a one-line
  reference in `.kiro/steering/architecture.md` § Module map:
  > Enforced by `.dependency-cruiser.cjs` (module-graph layer) +
  > `.semgrep/rules/` (file-content layer). Mirrors the semgrep back-link
  > convention.

- **D.4** Update `README.md` sub-spec roadmap: mark
  `dependency-cruiser-boundaries` as ✅ done.

**Acceptance**: `module-boundaries.md` exists; SVG renders; AGENTS.md,
steering, README updated; cross-references resolve.

## Final verification

```bash
pnpm test          # green
pnpm typecheck     # green
pnpm test:py       # green
pnpm scope-guard   # OK
pnpm semgrep       # 0 ERROR findings
pnpm deps:cruise   # 0 violations
```

## Commit plan

Single commit:

```
feat(deps): dependency-cruiser module boundaries + CI gate
```

Body summarizes Phase A-D + lists the 6 forbidden rules + links to
this sub-spec.

## Out-of-PR follow-ups

- **Python boundary**: if `apps/agent/` module map grows to ≥ 5 rules,
  file a sibling `python-module-boundaries` sub-spec evaluating
  import-linter vs tach vs pyright module-imports mode.
- **New-app smoke test**: a property test asserting every `apps/*/` and
  `packages/*/` is covered by at least one cruiser `from.path` rule.
  Cheap, catches drift if someone adds `apps/admin/` without a boundary.
  Today scale (4 apps + 3 packages) doesn't justify the test; revisit
  at 8 modules.
