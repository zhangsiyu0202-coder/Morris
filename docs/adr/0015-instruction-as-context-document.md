# ADR 0015: Instruction as the single AI moderator operating manual

## Status

Accepted (2026-07-12).

Refines the researcher-authored persona / research-context surface that
lives inside `Survey`. This ADR introduces a single `instruction` field
(free-form markdown) as the AI moderator's operating manual, and sunsets
four separately-typed fields (`moderatorInstruction`,
`flowConfig.researchGoal`, `flowConfig.targetAudience`,
`flowConfig.introScript`) whose values were composed into the same runtime
string but forced the researcher to split their thinking across four
form inputs.

Companion to ADR-0013 (Mastra migration) and ADR-0014 (declarative flow
engine); this is iteration 6 of that rollout.

## Context

Since the survey-editor sub-spec shipped, a researcher writing a study
had to fill four separate fields to reach the AI moderator:

- `Survey.moderatorInstruction` — persona / tone / delivery style.
- `Survey.flowConfig.researchGoal` — what the study is trying to learn.
- `Survey.flowConfig.targetAudience` — who is being interviewed.
- `Survey.flowConfig.introScript` — how to open the interview.

`packages/contracts/src/api.ts::buildInterviewWorkflowConfigFromDraft`
composed those four fields into a single `supervisorInstruction` string
that the LiveKit worker embedded verbatim into
`agent.instructions`. Downstream analysis Functions (analyzeSession,
analyzeSurvey) and Morris tools separately re-composed their own
research-backdrop prompts by re-reading `researchGoal` + `targetAudience`
directly, i.e. every LLM consumer built its own subset.

Three symptoms:

1. **Researcher cognitive overhead.** Splitting "what the AI needs to
   know to run this study" across four labeled boxes forces the
   researcher to plan how to allocate their thinking. Boundaries between
   "persona" and "research goal" are fuzzy in practice — every study
   ends up duplicating context in multiple boxes.
2. **Multiple LLM consumers, multiple compositions.** The interview
   worker, `analyzeSession`, `analyzeSurvey`, Notebook generation, and
   Morris tools each hit the four fields with slightly different prompt
   shapes. There is no single "research intent source of truth".
3. **Hard to represent instruction structure.** A researcher who wants a
   structured markdown document — headers, bullets, tables — has no
   affordance; the four `.min(1)` fields are single-line strings by
   editor convention.

Related failure mode: because the mapper (`buildSurveyDraftFromDocs`)
used to drop `moderatorInstruction` on the way to
`buildInterviewFlowConfigFromDraft`, the researcher's persona was
silently dropped for every interview (fixed in commit 37ee127). The
existence of four fields multiplied the surface area for such drift.

## Decision

`Survey` gains a single `instruction` column: **a free-form markdown
document that serves as the AI moderator operating manual** —
"CLAUDE.md-style". This one document contains everything the researcher
wants the AI moderator to know: what the study is about, who is being
interviewed, notes for delivery, research goals, open / close style.
No structured sub-fields; the researcher organizes the content with
markdown headers however they see fit.

### Ownership

- **Study-scoped**: each `Survey` has its own `instruction`. No
  workspace-level defaults, no user-level preferences, no cross-study
  templates, no system-level base. There is no composition or cascading:
  a single string in, a single string out.
- **Editor is the researcher**: hand-written or LLM-drafted-then-edited.
  Morris `createStudyDraft` may generate a baseline (see below), but
  the field remains researcher-owned.

### Baseline generation

The researcher rarely writes `instruction` from scratch. Two generation
paths land the baseline; both target the same field:

1. **Morris-led (existing path, refactored)**:
   `createStudyDraft` is a two-step generation:
   1. Draft the questions + sections (existing behaviour).
   2. Feed the drafted questions back to the LLM to produce a
      structured baseline `instruction` (using a Claude Code `/init`-style
      prompt: fixed section template + length constraints + few-shot
      example).
   Both artifacts land in the `SurveyDraft`; the researcher approves and
   the Survey lands with both fields populated.
2. **Direct create (new)**:
   The researcher creates a Study directly in the web editor, writes
   questions, then clicks a "生成 baseline" button in the guide editor.
   The backend calls the same baseline-generation prompt as (1), passing
   the current questions + title as context, and populates the
   `Survey.instruction` field. The researcher may edit the result or
   accept it as-is.

Both paths **generate after questions are in place** — the baseline is
derived from the questions, not from thin air. The researcher can then
edit the generated markdown; editing is optional, not required.

### Consumers

Every downstream LLM call reads the same `Survey.instruction` string
as its **single research-intent source of truth**. This replaces the
scattered access to `researchGoal / targetAudience / introScript /
moderatorInstruction`:

- **Interview agent** (`apps/agent-voice-worker`): `agent.instructions`
  becomes `flowConfig.instruction` verbatim.
- **`analyzeSession` Function**: uses `Survey.instruction` as the
  research-intent backdrop in the extraction / thematic-coding prompt.
- **`analyzeSurvey` Function**: same, at the rollup layer.
- **`Notebook` generation** and **Morris analysis tools**
  (`analyzeData`, `searchAcrossStudies`, etc.): use
  `Survey.instruction` when they need a description of what the study
  is about.

None of these consumers compose their own subset from the legacy
fields. The composed string is the input, no post-processing.

### Sunset checklist (legacy four fields)

The four legacy fields are marked `@deprecated` and remain readable for
one deprecation cycle. The mapper and composer implement a fallback
path: when `Survey.instruction` is empty, they reconstruct a supervisor
instruction from the four legacy fields (same code path as before this
ADR), so previously-published surveys keep working.

Sunset trigger: one full sub-spec cycle with `instruction` populated on
new surveys, plus a backfill migration for existing surveys, plus zero
rollback events.

Sunset actions (in a single PR, in order):

1. Delete `SurveyDraftSchema.{researchGoal, targetAudience, introScript,
   moderatorInstruction}`. `SurveySchema.moderatorInstruction` becomes
   unused too.
2. Remove those fields from `SurveyRow` (mapper) and `read.ts`.
3. Remove the fallback-compose path in `buildInterviewFlowConfigFromDraft`.
   The composer output becomes `flowConfig.moderatorInstruction = draft.instruction`
   trivially.
4. Delete `buildInterviewWorkflowConfigFromDraft` entirely (it exists
   only to produce the composed legacy string).
5. Remove the four fields from `Survey` Appwrite schema; run a
   destructive schema migration.
6. Follow-up ADR (0016 or later) records the sunset completion.

### UI layer (Wave 2)

The `guide-editor.tsx` today renders four inputs. Post-Wave 2, it
renders:
- One `title` text input (unchanged).
- One markdown editor for `instruction` (large textarea now; may upgrade
  to a rendered-preview markdown editor later — same underlying string).
- Questions authoring UI (unchanged).
- A "生成 baseline" button next to the `instruction` editor, enabled
  once at least one question exists, which calls the baseline
  generation endpoint.

The four legacy fields are removed from the UI in the same PR that
lands the new markdown editor. Because the fallback composer path
handles empty `instruction`, existing surveys stay valid — the
researcher sees an empty `instruction` and can either write from scratch
or click "生成 baseline".

## Consequences

Positive:

- **Single research-intent source**: every LLM consumer reads one field.
  Composition drift disappears.
- **Researcher writes one document**: no cognitive tax of splitting
  thinking across four labeled boxes.
- **Baseline generation is a first-class flow**: not a hidden side
  effect of `createStudyDraft`. Any researcher can regenerate the
  baseline after editing their questions.
- **Markdown structure available**: the researcher can add headers,
  bullets, tables — expressive when needed.
- **Analogy carries over**: like CLAUDE.md, one file per project,
  guides all agent actions.

Negative:

- **Migration cost**: existing surveys need a one-time backfill (script
  under `scripts/`, run manually) that concatenates the four legacy
  fields into a markdown skeleton, so post-sunset the composer's
  fallback is not needed. Wave 5's sunset PR carries the backfill.
- **Two composer paths temporarily**: during Wave 1..4, the composer
  has to prefer `draft.instruction` when non-empty and fall back to the
  legacy compose otherwise. Small extra branch, deleted at sunset.
- **UI churn for researchers with in-flight studies**: post-Wave 2, a
  researcher who returns to a study created pre-migration sees an
  empty `instruction` field (the four legacy fields having disappeared
  from the UI). They can either accept the composer's fallback (their
  interview still runs) or click "生成 baseline" to migrate.

## Rollout plan (wave-by-wave, non-breaking)

| Wave | Scope | Breaking? |
|---|---|---|
| **Wave 1** | Add `Survey.instruction` column + `SurveyDraft.instruction` field + mapper reads + composer prefers when non-empty + writer writes | Non-breaking, additive |
| **Wave 2** | Guide-editor UI:remove the four legacy inputs, add markdown editor + "生成 baseline" button + baseline generation endpoint | UX-breaking (researcher sees new UI), data-non-breaking |
| **Wave 3** | Morris `createStudyDraft` split into two-step generation; second step targets `instruction` | Non-breaking |
| **Wave 4** | analyzeSession / analyzeSurvey / Notebook / Morris tools switch to reading `Survey.instruction` (deprecating the ad-hoc composition from legacy fields) | Non-breaking (during the deprecation cycle) |
| **Wave 5** | Deprecate legacy four fields (add `@deprecated`, backfill script), then delete them (schema migration, contract sunset, code cleanup) | Breaking, one PR gated by follow-up ADR |

## Alternatives considered

- **Keep four fields, redesign the UI to hide the split**. Rejected —
  the DB shape leaks into every LLM consumer's prompt; hiding the split
  in the UI doesn't reduce the drift surface, it moves it.
- **Structured `instruction: { persona: string; goal: string; audience:
  string; open: string; close: string; notes: string }`**. Rejected —
  same problem as four fields but with more boxes. And a structured
  shape forecloses ad-hoc markdown structure that researchers may want
  (tables, code blocks, headers named for their study's specifics).
- **Move `instruction` to a workspace-level shared field**. Rejected —
  each study has its own research intent. Workspace-level sharing
  reintroduces cross-study drift and violates study-ownership boundary
  established elsewhere in the codebase.
- **Compose `instruction` at runtime from a template + a smaller
  "persona" field**. Rejected — same reason the four-field approach
  failed. Composition means every downstream consumer either re-runs
  the composition or reads a different subset; drift is guaranteed.

## Baseline-generation prompt design (reference for Wave 2)

The `/init`-style baseline generation uses:

1. **Fixed section template**: `## 研究意图 / ## 访谈对象 / ## 主持行
   为要点 / ## 开场 / ## 结束`. Prompt explicitly requires these
   sections in order.
2. **Length constraints**: each section ≤ 3 sentences, bullets ≤ 6.
3. **Style constraints**: 自然中文口语,不用官话,不用 emoji,不用 code
   blocks.
4. **Few-shot example**: 1 hand-crafted example in the system prompt
   (varies by study type, or one generic if type is unknown).
5. **Low temperature** (0.3–0.5) for stable output.

Model: `qwen-plus` (per ADR-0011 primary cascade); `qwen-max` if quality
gap warrants; DeepSeek dormant.

Storage: the generated markdown string is written verbatim to
`Survey.instruction`. Consumers embed the string in their LLM prompts;
no runtime markdown parsing.
