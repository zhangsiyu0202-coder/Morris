import { Lightbulb, ListOrdered } from "lucide-react";

import type { Insight as ReportInsightItem } from "./shared";
import type { SurveyReport, Theme } from "./shared";

type RankedFinding = NonNullable<SurveyReport["rankedFindings"]>[number];

interface RankedFindingsSectionProps {
  rankedFindings: SurveyReport["rankedFindings"];
  themes: Theme[];
  insights: ReportInsightItem[];
}

interface DisplayFinding {
  finding: RankedFinding;
  title: string;
  body: string;
  evidenceLabel: string;
  kindLabel: string;
}

function resolveFindings(
  rankedFindings: RankedFinding[],
  themes: Theme[],
  insights: ReportInsightItem[],
): DisplayFinding[] {
  const themesById = new Map(themes.map((theme) => [theme.id, theme]));
  const insightsById = new Map(insights.map((insight) => [insight.id, insight]));

  return rankedFindings.flatMap((finding) => {
    if (finding.kind === "theme") {
      const theme = themesById.get(finding.sourceId);
      if (!theme) return [];
      return [{
        finding,
        title: theme.label,
        body: "由受访者覆盖度和已验证访谈证据支持的主题。",
        evidenceLabel: `${theme.mentions} 人 · ${theme.pct}%`,
        kindLabel: "主题",
      }];
    }

    const insight = insightsById.get(finding.sourceId);
    if (!insight) return [];
    return [{
      finding,
      title: insight.title,
      body: insight.text,
      evidenceLabel: `洞察置信 ${Math.round(insight.confidence * 100)}%`,
      kindLabel: "洞察",
    }];
  });
}

export function RankedFindingsSection({
  rankedFindings,
  themes,
  insights,
}: RankedFindingsSectionProps) {
  if (!rankedFindings?.length) return null;
  const findings = resolveFindings(rankedFindings, themes, insights);
  if (findings.length === 0) return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="ranked-findings-title">
      <div className="flex items-center gap-2">
        <ListOrdered className="size-5 text-ink-600" aria-hidden="true" />
        <h2 id="ranked-findings-title" className="font-display text-xl font-semibold tracking-tight text-ink-900">
          优先发现
        </h2>
      </div>
      <p className="text-body-sm leading-relaxed text-ink-600">
        按研究目标相关性排序；覆盖人数、百分比和洞察置信度仍来自原始分析。
      </p>
      <ol className="grid gap-3 md:grid-cols-2">
        {findings.map(({ finding, title, body, evidenceLabel, kindLabel }) => (
          <li
            key={`${finding.kind}:${finding.sourceId}`}
            className="flex gap-3 rounded bg-mauve-50 px-4 py-4 shadow-[0_2px_4px_rgba(167,133,133,0.08)]"
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mauve-200 font-data text-body-sm text-ink-900"
              aria-label={`优先级 ${finding.rank}`}
            >
              {finding.rank}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-ink-600" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-decor text-caption text-ink-600">{kindLabel}</p>
                  <h3 className="text-body-sm font-semibold leading-snug text-ink-900">{title}</h3>
                </div>
              </div>
              <p className="text-body-sm leading-relaxed text-ink-600">{body}</p>
              <div className="flex items-center justify-between gap-3 font-data text-caption tabular-nums text-ink-500">
                <span>{evidenceLabel}</span>
                <span>{`模型相关度 ${Math.round(finding.relevanceScore * 100)}%`}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
