# Semgrep rules

> Source spec: `.kiro/specs/robustness-hardening/` REQ-1.

Pattern-level enforcement for binding rules in `.kiro/steering/*.md` that
have no other mechanical guard. Every rule has a companion fixture under
`rules/tests/` and is documented in its own YAML `message` field.

## Rules

| Rule | Severity | Hits today | Steering source |
|---|---|---|---|
| `handler-no-sdk-import` | ERROR | 0 | `architecture.md` § Function shape |
| `no-secret-in-source` | ERROR | 0 | `errors-and-observability.md` § Secret masking |
| `no-silent-catch-fallback` | ERROR | 0 | `errors-and-observability.md` § try/catch matrix |
| `no-bare-console-in-source` | ERROR | 0 | `errors-and-observability.md` § Logger contract |
| `no-inline-vi-mock-duplicate` | ERROR | 0 | `testing.md` § Test double pattern |

All five rules ship at ERROR severity. Adding a new violation fails CI
(`pnpm semgrep`). Genuinely-exempt sites use the standard inline
`// nosemgrep: <rule-id> (reason)` escape hatch above the matched line — the
reason text is for review and should be auditable.

## Commands

```bash
pnpm semgrep          # CI gate: fail-closed on ERROR findings only
pnpm semgrep:warn     # informational: list WARNING findings
pnpm semgrep:test     # run fixture tests for every rule
```

Local install:
```bash
uv tool install semgrep        # preferred
# or:
pip install --user semgrep
```

## Adding a new rule

1. Drop a YAML in `rules/<rule-id>.yaml`. Use `severity: ERROR` if existing
   code is already clean; `severity: WARNING` if you're introducing a rule
   against legacy.
2. Drop a fixture in `rules/<rule-id>.test.ts` (or `.py`) with
   `// ruleid: <rule-id>` markers above violating lines and `// ok: <rule-id>`
   above clean lines.
3. Verify locally: `pnpm semgrep:test`.
4. Run against the repo: `pnpm semgrep:warn` (full hit list) and `pnpm semgrep`
   (gate-only). Tighten patterns until WARN noise is manageable and ERROR
   gate is clean.
5. The rule's `message` field MUST link to the steering doc that owns the
   binding rule. The reader of a CI failure needs to find the *why* in one
   click.

## Escape hatch

Use the standard semgrep inline disable, NOT a project-specific convention:

```ts
// nosemgrep: <rule-id> (rationale a human reviewer can verify)
const x = ...;
```

The reason text after the rule id is for code review — every active
`nosemgrep:` should justify why this site is genuinely exempt. Treat the
comment as a TODO if the rationale is "haven't gotten around to fixing this".

## Why not eslint?

ESLint runs per-file and has trouble with cross-file taint (e.g., "this
literal appears in multiple files"). Semgrep is AST-aware across files, has
better support for path-conditional rules, and matches the PostHog reference
we borrow shape from. Steering rules of the form "X may not appear in Y"
are semgrep's native idiom.
