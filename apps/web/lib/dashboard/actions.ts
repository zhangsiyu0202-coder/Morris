"use server";

import { ID, Permission, Role } from "node-appwrite";
import { revalidatePath } from "next/cache";
import { DashboardTileLayoutSchema } from "@merism/contracts";
import { requireOwnerUserId } from "@/lib/owner";
import { DATABASE_ID, getServerClient, Query } from "@/lib/queries/client";
import { getOrCreateStudyDashboard } from "./queries";
import { getDashboardWidgetCatalogEntry, STUDY_OVERVIEW_WIDGET_TYPES } from "./widget-catalog";

const DASHBOARD_WIDGETS = "dashboard_widgets";
const DASHBOARD_TILES = "dashboard_tiles";

function ownerPermissions(ownerUserId: string): string[] {
  return [
    Permission.read(Role.user(ownerUserId)),
    Permission.update(Role.user(ownerUserId)),
    Permission.delete(Role.user(ownerUserId)),
  ];
}

function revalidateStudyDashboard(surveyId: string): void {
  revalidatePath(`/studies/${surveyId}/dashboard`);
}

function isStudyDashboardWidgetType(
  value: string,
): value is (typeof STUDY_OVERVIEW_WIDGET_TYPES)[number] {
  return STUDY_OVERVIEW_WIDGET_TYPES.includes(value as (typeof STUDY_OVERVIEW_WIDGET_TYPES)[number]);
}

export async function addDashboardWidget(input: {
  surveyId: string;
  widgetType: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ownerUserId = await requireOwnerUserId();
  const widgetType = input.widgetType;
  if (!isStudyDashboardWidgetType(widgetType)) {
    return { ok: false, error: "Unknown widget type." };
  }

  try {
    const databases = getServerClient().databases;
    const dashboard = await getOrCreateStudyDashboard(ownerUserId, input.surveyId, "研究概览", databases);
    if (!dashboard.persisted) return { ok: false, error: "Dashboard storage is not configured." };

    const entry = getDashboardWidgetCatalogEntry(widgetType);
    const maxBottom = dashboard.tiles.reduce(
      (bottom, tile) => Math.max(bottom, tile.layout.y + tile.layout.h),
      0,
    );
    const layout = DashboardTileLayoutSchema.parse({ ...entry.defaultLayout, y: maxBottom });
    const now = new Date().toISOString();

    const widget = await databases.createDocument(
      DATABASE_ID,
      DASHBOARD_WIDGETS,
      ID.unique(),
      {
        ownerUserId,
        dashboardId: dashboard.dashboard.$id,
        surveyId: input.surveyId,
        widgetType,
        name: entry.label,
        description: entry.description,
        config: JSON.stringify(entry.defaultConfig),
        createdAt: now,
        updatedAt: now,
      },
      ownerPermissions(ownerUserId),
    );

    await databases.createDocument(
      DATABASE_ID,
      DASHBOARD_TILES,
      ID.unique(),
      {
        ownerUserId,
        dashboardId: dashboard.dashboard.$id,
        surveyId: input.surveyId,
        widgetId: widget.$id,
        layout: JSON.stringify(layout),
        order: dashboard.tiles.length,
        createdAt: now,
        updatedAt: now,
      },
      ownerPermissions(ownerUserId),
    );

    revalidateStudyDashboard(input.surveyId);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not add widget." };
  }
}

export async function updateDashboardWidget(input: {
  surveyId: string;
  widgetId: string;
  name?: string;
  limit?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ownerUserId = await requireOwnerUserId();
  try {
    const databases = getServerClient().databases;
    const existing = await databases.getDocument(DATABASE_ID, DASHBOARD_WIDGETS, input.widgetId);
    if (existing.ownerUserId !== ownerUserId || existing.surveyId !== input.surveyId) {
      return { ok: false, error: "Widget not found." };
    }

    let config: Record<string, unknown> = {};
    if (typeof existing.config === "string") {
      try {
        config = JSON.parse(existing.config);
      } catch {
        config = {};
      }
    }
    if (typeof input.limit === "number" && Number.isInteger(input.limit)) {
      config.limit = Math.min(Math.max(input.limit, 1), 50);
    }

    await databases.updateDocument(DATABASE_ID, DASHBOARD_WIDGETS, input.widgetId, {
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      config: JSON.stringify(config),
      updatedAt: new Date().toISOString(),
    });

    revalidateStudyDashboard(input.surveyId);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update widget." };
  }
}

export async function deleteDashboardTile(input: {
  surveyId: string;
  tileId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ownerUserId = await requireOwnerUserId();
  try {
    const databases = getServerClient().databases;
    const rows = await databases.listDocuments(DATABASE_ID, DASHBOARD_TILES, [
      Query.equal("$id", input.tileId),
      Query.equal("ownerUserId", ownerUserId),
      Query.equal("surveyId", input.surveyId),
      Query.limit(1),
    ]);
    const tile = rows.documents[0];
    if (!tile) return { ok: false, error: "Tile not found." };

    await databases.deleteDocument(DATABASE_ID, DASHBOARD_TILES, input.tileId);
    if (typeof tile.widgetId === "string") {
      await databases.deleteDocument(DATABASE_ID, DASHBOARD_WIDGETS, tile.widgetId);
    }
    revalidateStudyDashboard(input.surveyId);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete tile." };
  }
}
