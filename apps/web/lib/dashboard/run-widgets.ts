import type {
  DashboardWidget,
  DashboardWidgetType,
  RunDashboardWidgetsOutput,
  SurveyAnalysisReportOutput,
} from "@merism/contracts";
import {
  getLatestAnalysisReport,
  listBookmarksForTenant,
  listSessions,
  parseSessionReportBody,
  parseSurveyReportBody,
} from "@/lib/queries";
import { scopeForOwner } from "@/lib/auth/workspace";
import type { TenantScope } from "@/lib/queries/client";
import { getOrCreateStudyDashboard, type DashboardTileWithWidget } from "./queries";

type WidgetRunner = (ctx: WidgetRunContext, widget: DashboardWidget) => Promise<unknown>;

type WidgetRunContext = {
  ownerUserId: string;
  scope: TenantScope;
  surveyId: string;
  surveyReport: SurveyAnalysisReportOutput | null;
};

function configLimit(widget: DashboardWidget, fallback: number, max: number): number {
  const raw = widget.config.limit;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return fallback;
  return Math.min(Math.max(raw, 1), max);
}

async function getSurveyReport(
  ownerUserId: string,
  surveyId: string,
): Promise<SurveyAnalysisReportOutput | null> {
  try {
    const report = await getLatestAnalysisReport(ownerUserId, { surveyId, scope: "survey" });
    return report ? parseSurveyReportBody(report) : null;
  } catch {
    return null;
  }
}

const WIDGET_REGISTRY = {
  study_progress: async ({ scope, surveyId }: WidgetRunContext) => {
    const sessions = await listSessions(scope, surveyId);
    const completedSessions = sessions.filter((session) => session.state === "completed").length;
    const totalSessions = sessions.length;
    return {
      totalSessions,
      completedSessions,
      completionRate: totalSessions === 0 ? 0 : Math.round((completedSessions / totalSessions) * 100),
    };
  },
  recent_sessions: async ({ scope, surveyId }, widget) => {
    const limit = configLimit(widget, 6, 20);
    const sessions = await listSessions(scope, surveyId);
    return {
      sessions: sessions.slice(0, limit).map((session) => ({
        sessionId: session.$id,
        respondent: session.intervieweeAlias ?? "匿名受访者",
        state: session.state,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      })),
    };
  },
  top_themes: async ({ surveyReport }, widget) => {
    const limit = configLimit(widget, 5, 20);
    return { themes: (surveyReport?.themes ?? []).slice(0, limit) };
  },
  top_insights: async ({ surveyReport }, widget) => {
    const limit = configLimit(widget, 4, 20);
    return { insights: (surveyReport?.insights ?? []).slice(0, limit) };
  },
  sentiment_breakdown: async ({ surveyReport }) => {
    return { sentimentBreakdown: surveyReport?.sentimentBreakdown ?? [] };
  },
  bookmarked_quotes: async ({ scope, surveyId }, widget) => {
    const limit = configLimit(widget, 5, 20);
    const bookmarks = await listBookmarksForTenant(scope, 100);
    return {
      bookmarks: bookmarks
        .filter((bookmark) => bookmark.surveyId === surveyId)
        .slice(0, limit)
        .map((bookmark) => ({
          id: bookmark.$id,
          sessionId: bookmark.sessionId,
          quote: bookmark.quote,
          source: bookmark.source,
          respondent: bookmark.respondent,
          createdAt: bookmark.createdAt,
        })),
    };
  },
  visual_moments: async ({ scope, ownerUserId, surveyId }, widget) => {
    const limit = configLimit(widget, 5, 20);
    const sessions = await listSessions(scope, surveyId);
    const moments: Array<{
      sessionId: string;
      timestampMs: number;
      label: string;
      description: string;
    }> = [];

    for (const session of sessions.slice(0, 30)) {
      if (moments.length >= limit) break;
      const report = await getLatestAnalysisReport(ownerUserId, {
        surveyId,
        scope: "session",
        sessionId: session.$id,
      });
      const body = report ? parseSessionReportBody(report) : null;
      for (const moment of body?.visualAnalysis?.keyMoments ?? []) {
        moments.push({
          sessionId: session.$id,
          timestampMs: moment.timestampMs,
          label: moment.label,
          description: moment.description,
        });
        if (moments.length >= limit) break;
      }
    }

    return { moments };
  },
  question_stats: async ({ surveyReport }, widget) => {
    const limit = configLimit(widget, 6, 50);
    return { questionStats: (surveyReport?.questionStats ?? []).slice(0, limit) };
  },
} satisfies Record<DashboardWidgetType, WidgetRunner>;

async function runOne(
  tile: DashboardTileWithWidget,
  ctx: WidgetRunContext,
): Promise<RunDashboardWidgetsOutput["results"][number]> {
  const runner = WIDGET_REGISTRY[tile.widget.widgetType];
  try {
    return {
      tileId: tile.$id,
      widgetId: tile.widget.$id,
      widgetType: tile.widget.widgetType,
      result: await runner(ctx, tile.widget),
      error: null,
    };
  } catch {
    return {
      tileId: tile.$id,
      widgetId: tile.widget.$id,
      widgetType: tile.widget.widgetType,
      result: null,
      error: "Widget query failed.",
    };
  }
}

export async function runDashboardWidgets(input: {
  ownerUserId: string;
  surveyId: string;
  dashboardId?: string;
  tileIds?: string[];
}): Promise<RunDashboardWidgetsOutput> {
  const dashboard = await getOrCreateStudyDashboard(input.ownerUserId, input.surveyId);
  const requested = input.tileIds ? new Set(input.tileIds) : null;
  const tiles = dashboard.tiles.filter((tile) => !requested || requested.has(tile.$id));
  const ctx: WidgetRunContext = {
    ownerUserId: input.ownerUserId,
    scope: await scopeForOwner(input.ownerUserId),
    surveyId: input.surveyId,
    surveyReport: await getSurveyReport(input.ownerUserId, input.surveyId),
  };

  return { results: await Promise.all(tiles.map((tile) => runOne(tile, ctx))) };
}

export { WIDGET_REGISTRY };
