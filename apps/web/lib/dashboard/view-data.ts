import type { RunDashboardWidgetsOutput } from "@merism/contracts";
import { getOwnerUserIdOrNull } from "@/lib/auth/owner";
import { getStudy } from "@/lib/queries";
import { scopeForOwner } from "@/lib/auth/workspace";
import { getOrCreateStudyDashboard, type StudyDashboard } from "./queries";
import { runDashboardWidgets } from "./run-widgets";

export type StudyDashboardView = StudyDashboard & {
  widgetResults: RunDashboardWidgetsOutput["results"];
  studyTitle: string;
};

export async function loadStudyDashboard(surveyId: string): Promise<StudyDashboardView> {
  const ownerUserId = await getOwnerUserIdOrNull();
  if (!ownerUserId) {
    const dashboard = await getOrCreateStudyDashboard("mock-owner", surveyId, "研究概览");
    return {
      ...dashboard,
      widgetResults: dashboard.tiles.map((tile) => ({
        tileId: tile.$id,
        widgetId: tile.widget.$id,
        widgetType: tile.widget.widgetType,
        result: null,
        error: null,
      })),
      studyTitle: "研究概览",
    };
  }

  const study = await getStudy(await scopeForOwner(ownerUserId), surveyId).catch(() => null);
  const studyTitle = study?.survey.title ?? "研究概览";
  const dashboard = await getOrCreateStudyDashboard(ownerUserId, surveyId, studyTitle);
  const widgetResults = await runDashboardWidgets({
    ownerUserId,
    surveyId,
    dashboardId: dashboard.dashboard.$id,
  });

  return {
    ...dashboard,
    widgetResults: widgetResults.results,
    studyTitle,
  };
}
