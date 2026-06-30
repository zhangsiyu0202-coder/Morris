# Sub-spec: `prompt-versioning`

> **Status**: stub (requirements drafted; design + tasks pending scheduling).
> **Parent spec**: `.kiro/specs/robustness-hardening/` (Wave B REQ-9)
> **Created**: 2026-06-30, scheduled as Wave B during robustness-hardening planning.

## Motivation

Analysis Function prompts (`analyzeSession` text-pass / quality-flags, `analyzeSurvey`
extract / assign / combine / compose) live as inline TypeScript template strings inside
`apps/functions/<name>/src/deps.ts`. Two consequences:

1. **No version history independent of git**. Changing a prompt = git diff against `deps.ts`.
   When you want to know "did the prompt change between 2026-Q1 and 2026-Q2?", you grep git log.
   Workable, but painful when investigating a regression.
2. **No A/B testability**. To compare prompt A vs prompt B, you fork the deps.ts function. To
   roll back a prompt, you revert a commit. Both are heavier than they need to be.
3. **No co-located golden test**. The current prompt's expected behavior lives in the developer's
   head + a few unit tests. When the prompt changes, the tests are updated in the same PR but
   there's no formal "this prompt version produces this output on this fixture" record.

PostHog moved their AI prompts (`ee/hogai/prompts/`) to versioned `.md` files about a year ago.
The motivation was the same: regression debugging + reversibility. We borrow the shape but
adapt for MerismV2 stack (Functions, not Django views; `.md` with frontmatter, not Python
strings).

This sub-spec depends on `ai-eval-suite` (REQ-7) — without the eval harness, "version a prompt"
has nothing to score the version against.

## Requirements

### REQ-1: Prompt files as versioned Markdown

**WHAT**: each LLM prompt currently inline in a Function moves to a file:

```
apps/functions/<name>/prompts/<phase>/
  v1.md            # initial version, exact transcript of today's inline string
  v2.md            # subsequent versions (created by PRs, never edited in-place)
  active.json      # { "version": "v2" } — single source of truth for which version is used
```

Each `vN.md` carries frontmatter:

```yaml
---
phase: text-pass
function: analyzeSession
created: 2026-07-15
created-by: morris
purpose: |
  Initial extraction pass — produces themed code list with citations.
  Replaces inline template in deps.ts as of PR #NNN.
parent: v1
changes-from-parent: |
  Tightened instruction on citation format; added refusal pattern for empty transcript.
---

# System prompt

You are a qualitative researcher analyzing an interview transcript...
```

**Acceptance**: every analysis Function's inline prompt string is replaced by a file read.
`grep -RIn 'You are' apps/functions/*/src/deps.ts` returns 0 results.

### REQ-2: Loader with active-version resolution

**WHAT**: a `packages/observability/src/prompts.ts` (or its own `packages/prompts/` package)
exporting:

```ts
export function loadPrompt(
  scope: `${"function" | "action" | "morris"}.${string}.${string}`,
  opts?: { override?: string }, // for evals / A/B
): string;
```

Resolution rule:
- `scope = "function.analyzeSession.text-pass"` → reads
  `apps/functions/analyzeSession/prompts/text-pass/active.json` → reads
  the corresponding `vN.md` → returns the prompt string (frontmatter stripped).
- `opts.override = "v2"` → bypass active.json, load `v2.md` directly. Used by evals and CLI tools.
- File read is cached in-process after first hit (these files don't change at runtime).

**Acceptance**: every analysis Function calls `loadPrompt(scope)` in place of inline strings.
Switching `active.json` from v1 to v2 is a one-line PR; no Function code change needed.

### REQ-3: Golden test per prompt version

**WHAT**: depends on `ai-eval-suite`. Each `vN.md` MUST have at least one matching scenario in
`tests/evals/corpus/<function>/<phase>.jsonl` tagged with `prompt-version: "vN"`. The eval
harness scores the output against the rubric for that version.

When a new version is created:
- The PR MUST include corpus row(s) for the new version (can copy existing rows with
  version-bumped tag).
- The PR MUST include the eval output for both old and new version (artifact link).
- `pnpm test:evals` runs the OLD version's corpus rows against the NEW prompt and reports
  any regressions in the PR comment.

**Acceptance**: introducing `v2.md` without an updated corpus row fails CI (a soft gate per
the eval harness's `prompt-version` tag check). Switching `active.json` to v2 fails CI if
v2's pass rate is below v1's by more than a configured delta (default 5%).

### REQ-4: Migration of existing prompts

**WHAT**: enumerate every LLM-call site per `errors-and-observability.md` § Wave B 接入清单:

| Function / surface | Phases to extract |
|---|---|
| `analyzeSession` | text-pass, quality-flags |
| `analyzeSurvey` | extract, assign, combine, compose |
| `notebooks.generateReport` (action) | generate-report |
| `guide-ai.generateGuide` (action) | generate-guide |
| `guide-ai.expandSection` (action) | expand-section |
| `conversations.title.generate` | title-generate |

Plus Morris tool internal prompts (currently inlined in the tool body or the model wrapper).

Each gets a `prompts/<phase>/v1.md` snapshot of today's exact string, an `active.json`, and a
corresponding loader call. The semantic shouldn't change — this is a strictly mechanical move.

**Acceptance**: post-migration, running the analysis evals (REQ-3) on `v1.md` produces
identical outputs to pre-migration runs (within judge-model variance bound).

### REQ-5: ADR + steering update

**WHAT**: add a steering note in `architecture.md` § Where new things go:

> | LLM prompt | `apps/functions/<name>/prompts/<phase>/vN.md` + bump `active.json` |

Plus a short ADR (`docs/adr/0013-versioned-llm-prompts.md`) explaining the trade-off:
- File-per-version vs git-tracked inline string (latter is simpler but loses A/B + rollback
  story).
- File loader at startup vs runtime (we pick startup-cached because Functions are short-lived
  invocations).

**Acceptance**: ADR-0013 committed; architecture.md updated.

## Out of scope

- Prompt templating language (Jinja-style variable substitution). For now, prompts are
  static strings; runtime values (transcript text, survey config) are passed as separate
  `userPrompt` sections, not interpolated into the system prompt. Templating is a future
  capability if needed.
- Hot-reload of prompts at runtime (without a Function redeploy). Functions are stateless
  and short-lived; cold-start cost of file read is microseconds. No need for hot-reload.
- Prompts written by non-engineers (PMs / researchers contributing prompts directly). The
  authoring workflow stays "PR with file changes" — opening it up to a CMS is a different
  product surface.
- LiveKit Agent system prompts (`workflow_config.supervisorInstruction`). Those are composed
  per-interview from `Survey.flowConfig` + `moderatorInstruction` — they're DATA, not a static
  prompt. Versioning the COMPOSITION FUNCTION (`buildInterviewWorkflowConfigFromDraft`) is a
  separate question.

## Open questions (to resolve during design)

1. **File location**: under each function's directory (`apps/functions/<name>/prompts/`) or in
   a central `prompts/` package? Under-the-function keeps related code close; central
   prompts/ enables cross-function reuse. Default: under each function; revisit if sharing
   emerges.
2. **`active.json` shape**: just `{"version": "vN"}` or richer (`{"version": "vN", "rolloutPct": 50}`
   for canary rollouts)? Start minimal; canary needs more orchestration (per-tenant active
   version) and crosses into product surface.
3. **Markdown rendering at load time**: do we strip the frontmatter and pass the body as-is,
   or apply some preprocessing (e.g., strip code-fence markers around the prompt body)?
   Default: strip frontmatter via `gray-matter`, pass body verbatim.
4. **Eval corpus per version vs per phase**: every phase has multiple versions over time.
   Should the corpus rows be tagged by `(phase, version)` or by `(phase, scenario-id)` with
   version-specific expected outputs? Default: per-scenario, version-specific expected
   outputs (most flexible, lets you share fixtures across versions).
5. **Deletion policy**: when can we delete an old `vN.md`? Suggested: after no
   `active.json` has pointed to it for 6 months and it has no failing corpus rows. Probably
   never delete in practice; storage is cheap.

## Scheduling notes

- **Estimated wave size**: medium-large. ~6 functions × 1-3 phases each = 10-15 prompt files
  to extract. Loader is small. Migration is mechanical but each file needs human review
  ("did I copy the prompt exactly?").
- **Trigger to flesh out**: after `ai-eval-suite` lands (this sub-spec depends on it for
  golden tests), or when a prompt regression is debugged and the lack of version history
  causes pain.
- **Pre-reqs**:
  - `ai-eval-suite` (REQ-7 sub-spec) MUST land first — the golden-test acceptance criterion
    has no meaning without the eval harness.
  - Recommended: `lint-baseline-cleanup` first (clean baseline so we don't add `nosemgrep:`
    annotations on top of existing WARN noise).
- **Estimated effort**: 2-3 days for migration + loader + 1-2 days for goldens (once
  ai-eval-suite is in place).
- **Sequencing**: LAST of the Wave B sub-specs.

## References

- Parent spec: `.kiro/specs/robustness-hardening/{requirements,design,tasks}.md` REQ-9
- Sibling spec (hard dependency): `.kiro/specs/ai-eval-suite/requirements.md`
- Steering: `.kiro/steering/architecture.md` § Where new things go, `.kiro/steering/errors-and-observability.md` § Wave B 接入清单
- ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md`; new ADR-0013 will document the decision.
- PostHog reference: `~/posthog/ee/hogai/prompts/` (their `.md` prompt versioning structure)
