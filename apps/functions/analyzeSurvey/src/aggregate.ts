// Pure functions that reduce many session-level reports + their underlying
// answers into the data half of a survey-level report.
//
// Two clean inputs, no SDK access, no LLM calls — exhaustively unit-tested.
//
// Anything that requires LLM reasoning (cross-session theme merging,
// generated insights, citation re-mapping) lives in the LLM prompt
// (prompts/survey-rollup.ts) and is invoked by the handler in a separate
// step.

import type { SurveyQuestionStat } from "@merism/contracts";

export interface SurveyDef {
  surveyId: string;
  title: string;
  questionBlocks: Array<{
    questionId: string;
    type: string;
    prompt: string;
    config: Record<string, unknown>;
  }>;
}

/**
 * One row per (session, question), already extracted from a session's
 * `collectedAnswers` jsonb. The handler builds these from raw documents
 * before calling aggregateQuestionStats.
 */
export interface AnswerRecord {
  sessionId: string;
  questionId: string;
  questionType: string;
  /** For choice-type answers: a single label or the "selected" array. */
  selectedOptions?: string[];
  /** For rating / nps: numeric score. */
  score?: number;
}

/**
 * Roll up answers into question-level stats. Choice / rating / nps each take
 * the dedicated branch; voice_only and other text-only types are skipped here
 * (those are summarized by the LLM stage instead).
 */
export function aggregateQuestionStats(
  survey: SurveyDef,
  answers: AnswerRecord[],
): SurveyQuestionStat[] {
  const byQuestion = new Map<string, AnswerRecord[]>();
  for (const a of answers) {
    const list = byQuestion.get(a.questionId) ?? [];
    list.push(a);
    byQuestion.set(a.questionId, list);
  }

  const stats: SurveyQuestionStat[] = [];
  for (const q of survey.questionBlocks) {
    const rows = byQuestion.get(q.questionId) ?? [];
    if (rows.length === 0) continue; // no answers, nothing to aggregate

    if (q.type === "single_choice" || q.type === "multi_choice" || q.type === "ranking") {
      const options = (q.config.options as string[] | undefined) ?? [];
      const counts = new Map<string, number>();
      for (const r of rows) {
        for (const opt of r.selectedOptions ?? []) {
          counts.set(opt, (counts.get(opt) ?? 0) + 1);
        }
      }
      const total = rows.length;
      const data = (options.length > 0 ? options : Array.from(counts.keys())).map((label) => {
        const count = counts.get(label) ?? 0;
        return {
          label,
          count,
          pct: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
        };
      });
      stats.push({
        questionId: q.questionId,
        questionText: q.prompt,
        kind: "choice",
        multi: q.type === "multi_choice" || q.type === "ranking",
        total,
        reportQuestion: q.prompt,
        summary: "",
        data,
      });
    } else if (q.type === "rating") {
      const total = rows.length;
      const sum = rows.reduce((acc, r) => acc + (r.score ?? 0), 0);
      const average = total === 0 ? 0 : Math.round((sum / total) * 100) / 100;
      const dist = new Map<number, number>();
      for (const r of rows) {
        if (typeof r.score === "number") {
          dist.set(r.score, (dist.get(r.score) ?? 0) + 1);
        }
      }
      const scaleMax = (q.config.scaleMax as number | undefined) ?? 5;
      stats.push({
        questionId: q.questionId,
        questionText: q.prompt,
        kind: "rating",
        total,
        average,
        scaleMax,
        reportQuestion: q.prompt,
        summary: "",
        data: Array.from(dist.entries())
          .map(([score, count]) => ({ score, count }))
          .sort((a, b) => a.score - b.score),
      });
    } else if (q.type === "nps") {
      const total = rows.length;
      let promoters = 0;
      let passives = 0;
      let detractors = 0;
      for (const r of rows) {
        const s = r.score ?? -1;
        if (s >= 9) promoters++;
        else if (s >= 7) passives++;
        else if (s >= 0) detractors++;
      }
      const score =
        total === 0
          ? 0
          : Math.round(((promoters - detractors) / total) * 100);
      stats.push({
        questionId: q.questionId,
        questionText: q.prompt,
        kind: "nps",
        total,
        score,
        promoters,
        passives,
        detractors,
        reportQuestion: q.prompt,
        summary: "",
      });
    }
    // Other types (open_ended, text, info, voice_only) are intentionally
    // skipped here — the LLM rollup handles narrative summaries.
  }
  return stats;
}
