import type { SurveyReport } from "./shared";
import { SentimentTag } from "./shared";

type Citation = SurveyReport["citations"][number];
type Theme = SurveyReport["themes"][number];

interface EvidenceListProps {
  /** Verbatim quotes pulled by the LLM, each tied back to a transcript segment. */
  citations: Citation[];
  /** All themes from the same report — used to look up sentiment + label for the `themeIds` on each citation. */
  themes: Theme[];
}

/**
 * Render the `citations` array of a survey-level AnalysisReport.
 *
 * Why this exists:
 * The analysis-report sub-spec ships two invariants that the rest of the
 * report UI doesn't surface today:
 *   - P-ANL-01: every theme carries >= 1 evidence ref.
 *   - P-DATA-04: every citation is traceable to a transcript segment.
 * Themes are charted by AnalysisSection, but the verbatim quotes — the
 * provenance side of P-DATA-04 — were never rendered. This section closes
 * that gap so reviewers can audit the LLM's claims against actual transcript
 * text without leaving the report page.
 *
 * Click-through to the transcript view is intentionally out of scope here:
 * the transcript viewer doesn't accept a deep-link target yet, so the
 * segment ref is shown read-only (transcriptId · 段 N) until that lands.
 */
export function EvidenceList({ citations, themes }: EvidenceListProps) {
  if (citations.length === 0) return null;

  const themeById = new Map(themes.map((t) => [t.id, t]));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">
        引用证据
      </h2>
      <p className="font-ui text-body-sm leading-relaxed text-ink-500">
        报告中引用的逐字 quote,每条可回溯到原始 transcript 段(P-DATA-04)。
      </p>
      <ul className="flex flex-col gap-3">
        {citations.map((citation, i) => {
          const segLabel = `${citation.segmentRef.transcriptId} · 段 ${citation.segmentRef.segmentIndex}`;
          const themesForCitation = citation.themeIds
            .map((id) => themeById.get(id))
            .filter((t): t is Theme => Boolean(t));
          return (
            <li
              key={`${citation.segmentRef.transcriptId}-${citation.segmentRef.segmentIndex}-${i}`}
              className="flex flex-col gap-2 rounded bg-mauve-50 px-4 py-4 shadow-[0_2px_4px_rgba(167,133,133,0.08)]"
            >
              <blockquote className="font-reading text-body leading-relaxed text-ink-800">
                <span className="text-ink-400" aria-hidden="true">
                  &ldquo;
                </span>
                {citation.quote}
                <span className="text-ink-400" aria-hidden="true">
                  &rdquo;
                </span>
              </blockquote>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {themesForCitation.map((theme) => (
                  <span
                    key={theme.id}
                    className="inline-flex items-center gap-1.5"
                  >
                    <SentimentTag sentiment={theme.sentiment} />
                    <span className="font-ui text-caption text-ink-700">
                      {theme.label}
                    </span>
                  </span>
                ))}
                <span
                  className="ml-auto font-data text-caption tabular-nums text-ink-500"
                  title={segLabel}
                >
                  {segLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
