# Tasks: `lint-baseline-cleanup`

> **Parent**: `.kiro/specs/lint-baseline-cleanup/{requirements,design}.md`
> Sub-spec scoped as one PR; tasks are intra-PR work units, not commit boundaries.

## Phase A — clear `no-silent-catch-fallback` (20 sites)

> Reference: design.md § File-by-file plan, table 1.
> Each task = one file. Tasks A.1 – A.13 are independent and can be done in any order.

- **A.1** `apps/functions/aggregateWorkspaceUsage/src/deps.ts:47` — add `nosemgrep:` with reason "best-effort usage event emit".
- **A.2** `apps/functions/analyzeSession/src/quality-flags.ts:81` — `nosemgrep:` "defensive parse, fall back to empty flags".
- **A.3** `apps/functions/changePlan/src/deps.ts:18` — `nosemgrep:` "billing lookup, null = no subscription".
- **A.4** `apps/functions/inviteMember/src/deps.ts:24,39` — two `nosemgrep:` annotations with category-1 / category-2 rationale.
- **A.5** `apps/functions/issueLivekitToken/src/deps.ts:148` — `nosemgrep:` "orphan reclaim, failure is non-blocking".
- **A.6** `apps/functions/stripeWebhook/src/deps.ts:74` — `nosemgrep:` "idempotent event lookup".
- **A.7** `apps/web/app/api/dev-issue-token/route.ts:128` — `nosemgrep:` "dev-only route best-effort".
- **A.8** `apps/web/lib/auth/current-user.ts:16,23` — two `nosemgrep:` (no session / no cookie).
- **A.9** `apps/web/lib/auth/workspace.ts:25` — `nosemgrep:` "cookie parse, null = unset".
- **A.10** `apps/web/lib/dashboard/run-widgets.ts:34` — **rewrite**: log error via `createLogger("dashboard.run-widgets").error(...)` then skip widget. No fallback to silent return.
- **A.11** `apps/web/lib/interview/transport.ts:70,90,228` — **rewrite** three sites: `createLogger("interview.transport").error(...)` before returning null. The null fallback stays; the log is the addition.
- **A.12** `apps/web/lib/queries/auth.ts:28,72` — two `nosemgrep:` annotations.
- **A.13** `apps/web/lib/survey/read.ts:57,133,190` — three `nosemgrep:` "read fallback, null = not found".

**Acceptance**: `pnpm semgrep:warn 2>&1 | grep no-silent-catch-fallback | wc -l` returns 0.

## Phase B — clear `no-bare-console-in-source` (16 sites)

- **B.1** `apps/web/app/api/assistant/route.ts:59,104,112` — `createLogger("route.assistant.post")` at function entry, three call-sites migrate.
- **B.2** `apps/web/app/api/dev-issue-token/route.ts:249` — `createLogger("route.dev-issue-token.post")` at entry.
- **B.3** `apps/web/components/assistant/tool-results.tsx:292` — `createLogger("component.assistant.tool-results")`. Client component; logger imports from `@merism/observability` work in both environments (verify).
- **B.4** `apps/web/lib/actions/guide-ai.ts:107,150` — two scopes: `action.guide-ai.generate` (line 107) and `action.guide-ai.expand-section` (line 150). Match the existing LLM-call observability registry.
- **B.5** `apps/web/lib/actions/notebooks.ts:194` — `createLogger("action.notebooks.createNotebook")`. The action already has an LLM-call site logged elsewhere; this is the secondary failure path.
- **B.6** `apps/web/lib/assistant/tool-template.ts:21,26` — **nosemgrep with TODO reason** ("template placeholder; replace with createLogger(scope) in your tool"). Both lines.
- **B.7** `apps/web/lib/interview/issue-token.ts:55,81,86,106` — `createLogger("interview.issue-token")` at module level or function entry; four call-sites migrate.
- **B.8** `apps/web/lib/queries/studies.ts:24` — `createLogger("queries.studies").warn(...)`. Already a `console.warn`; semantic preserved.
- **B.9** `apps/web/lib/server/notebooks.ts:143` — `createLogger("server.notebooks")`.

**Acceptance**: `pnpm semgrep:warn 2>&1 | grep no-bare-console-in-source | wc -l` returns 0.

## Phase C — promote both rules to ERROR severity

- **C.1** `.semgrep/rules/no-silent-catch-fallback.yaml` — change `severity: WARNING` to `severity: ERROR`. Delete the "Wave A note" paragraph from `message` (the one that explains WARN status and the cleanup sub-spec link).
- **C.2** `.semgrep/rules/no-bare-console-in-source.yaml` — same operations.
- **C.3** `.semgrep/README.md` — update rule catalog table: both rules now ERROR / 0 hits. Drop the `¹` footnote that mentioned the Wave A baseline.

**Acceptance**: `pnpm semgrep` (which uses `--severity ERROR --error`) fails if any pattern reappears; `pnpm semgrep:warn` returns 0 findings; `.semgrep/README.md` no longer mentions Wave A baseline status.

## Phase D — record promotion in ADR-0012

- **D.1** `docs/adr/0012-borrow-engineering-practices-from-posthog.md` — add one consequence line under the existing "Consequences" or "Outcomes" section: "2026-06-30: Wave A's two WARNING-severity rules (`no-silent-catch-fallback`, `no-bare-console-in-source`) promoted to ERROR after baseline cleanup completed via `.kiro/specs/lint-baseline-cleanup/`."

**Acceptance**: ADR-0012 mentions the promotion date.

## Final verification

```bash
pnpm test          # green
pnpm typecheck     # green
pnpm test:py       # green
pnpm scope-guard   # OK
pnpm semgrep       # 0 ERROR findings
pnpm semgrep:warn  # 0 WARN findings (the post-promotion state — both ex-WARN rules now ERROR-gated)
```

## Commit plan

Single conventional-commit message:

```
chore(observability): clear semgrep baseline + promote two rules to ERROR
```

Body summarizes Phase A / B / C / D counts and links to this sub-spec.

## Out-of-PR follow-ups

- File a future sub-spec `observability-besteffort-helper` if `nosemgrep:`
  annotations with the "best-effort cleanup" rationale exceed ~10. Today they
  total ~7 (Phase A category-2 sites); if a future Function adds 3 more,
  trigger the helper sub-spec.
- The `tool-template.ts` scaffold's two `nosemgrep:` annotations should be
  audited every 6 months — if no new Morris tool has been authored using the
  template in that window, consider deleting the template entirely.
