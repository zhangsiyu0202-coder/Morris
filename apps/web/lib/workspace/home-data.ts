import {
  countCompletedSessions,
  getLatestAnalysisReport,
  listBookmarksForTenant,
  listStudies,
} from "@/lib/queries";

export type HomeBookmark = {
  id: string;
  respondent: string;
  date: string;
  quote: string;
  source: string;
};

export type HomeReportPreview = {
  surveyId: string;
  title: string;
  subtitle: string;
  lastRun: string;
  hasReport: boolean;
};

function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Load up to five survey report previews for the home dashboard. */
export async function loadHomeReportPreviews(
  ownerUserId: string,
): Promise<HomeReportPreview[]> {
  const studies = await listStudies();

  const cards = await Promise.all(
    studies.map(async (study) => {
      const completed = await countCompletedSessions(study.$id);
      if (completed === 0) return null;

      const report = await getLatestAnalysisReport(ownerUserId, {
        surveyId: study.$id,
        scope: "survey",
      });

      return {
        surveyId: study.$id,
        title: study.title,
        subtitle: `${completed} 份完成访谈`,
        lastRun: report ? formatShortDate(report.generatedAt) : "报告生成中",
        hasReport: Boolean(report),
        sortKey: report?.generatedAt ?? study.updatedAt,
      };
    }),
  );

  return cards
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .slice(0, 5)
    .map(({ sortKey: _sortKey, ...rest }) => rest);
}

/** Load recent bookmarks for the home dashboard bookmark wall. */
export async function loadHomeBookmarks(ownerUserId: string): Promise<HomeBookmark[]> {
  const bookmarks = await listBookmarksForTenant(20);
  return bookmarks.map((bm) => ({
    id: bm.$id,
    respondent: bm.respondent,
    date: formatShortDate(bm.createdAt),
    quote: bm.quote,
    source: bm.source,
  }));
}
