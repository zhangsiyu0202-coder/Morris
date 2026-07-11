import { ID, Permission, Role, type Databases } from "node-appwrite";
import {
  DashboardSchema,
  DashboardTileSchema,
  DashboardWidgetSchema,
  type Dashboard,
  type DashboardTile,
  type DashboardWidget,
} from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "@/lib/queries/client";
import {
  getDashboardWidgetCatalogEntry,
  STUDY_OVERVIEW_PRESET_ID,
  STUDY_OVERVIEW_WIDGET_TYPES,
} from "./widget-catalog";

const DASHBOARDS = "dashboards";
const DASHBOARD_WIDGETS = "dashboard_widgets";
const DASHBOARD_TILES = "dashboard_tiles";

export type DashboardTileWithWidget = DashboardTile & { widget: DashboardWidget };

export type StudyDashboard = {
  dashboard: Dashboard;
  tiles: DashboardTileWithWidget[];
  persisted: boolean;
};

function db(): Databases {
  return getServerClient().databases;
}

function parseJsonColumn(raw: unknown, key: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...(raw as Record<string, unknown>) };
  const value = out[key];
  if (typeof value === "string") {
    try {
      out[key] = JSON.parse(value);
    } catch {
      out[key] = key === "layout" ? { x: 0, y: 0, w: 4, h: 3 } : {};
    }
  }
  return out;
}

function parseDashboard(raw: unknown): Dashboard | null {
  const parsed = DashboardSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseWidget(raw: unknown): DashboardWidget | null {
  const parsed = DashboardWidgetSchema.safeParse(parseJsonColumn(raw, "config"));
  return parsed.success ? parsed.data : null;
}

function parseTile(raw: unknown): DashboardTile | null {
  const parsed = DashboardTileSchema.safeParse(parseJsonColumn(raw, "layout"));
  return parsed.success ? parsed.data : null;
}

function ownerPermissions(ownerUserId: string): string[] {
  return [
    Permission.read(Role.user(ownerUserId)),
    Permission.update(Role.user(ownerUserId)),
    Permission.delete(Role.user(ownerUserId)),
  ];
}

function virtualStudyDashboard(ownerUserId: string, surveyId: string, title = "研究概览"): StudyDashboard {
  const now = new Date().toISOString();
  const dashboardId = `virtual_${surveyId}_dashboard`;
  const dashboard = DashboardSchema.parse({
    $id: dashboardId,
    ownerUserId,
    surveyId,
    scope: "study",
    name: title,
    presetId: STUDY_OVERVIEW_PRESET_ID,
    createdAt: now,
    updatedAt: now,
  });

  const tiles = STUDY_OVERVIEW_WIDGET_TYPES.map((widgetType, index) => {
    const entry = getDashboardWidgetCatalogEntry(widgetType);
    const widget = DashboardWidgetSchema.parse({
      $id: `virtual_${surveyId}_${widgetType}`,
      ownerUserId,
      dashboardId,
      surveyId,
      widgetType,
      name: entry.label,
      description: entry.description,
      config: entry.defaultConfig,
      createdAt: now,
      updatedAt: now,
    });
    return {
      ...DashboardTileSchema.parse({
        $id: `virtual_${surveyId}_${widgetType}_tile`,
        ownerUserId,
        dashboardId,
        surveyId,
        widgetId: widget.$id,
        layout: entry.defaultLayout,
        order: index,
        createdAt: now,
        updatedAt: now,
      }),
      widget,
    };
  });

  return { dashboard, tiles, persisted: false };
}

async function createDefaultStudyDashboard(
  ownerUserId: string,
  surveyId: string,
  title: string,
  databases: Databases,
): Promise<StudyDashboard> {
  const now = new Date().toISOString();
  const dashboard = await databases.createDocument(
    DATABASE_ID,
    DASHBOARDS,
    ID.unique(),
    {
      ownerUserId,
      surveyId,
      scope: "study",
      name: title,
      presetId: STUDY_OVERVIEW_PRESET_ID,
      createdAt: now,
      updatedAt: now,
    },
    ownerPermissions(ownerUserId),
  );
  const parsedDashboard = parseDashboard(dashboard);
  if (!parsedDashboard) return virtualStudyDashboard(ownerUserId, surveyId, title);

  const tiles: DashboardTileWithWidget[] = [];
  for (const [index, widgetType] of STUDY_OVERVIEW_WIDGET_TYPES.entries()) {
    const entry = getDashboardWidgetCatalogEntry(widgetType);
    const widget = await databases.createDocument(
      DATABASE_ID,
      DASHBOARD_WIDGETS,
      ID.unique(),
      {
        ownerUserId,
        dashboardId: parsedDashboard.$id,
        surveyId,
        widgetType,
        name: entry.label,
        description: entry.description,
        config: JSON.stringify(entry.defaultConfig),
        createdAt: now,
        updatedAt: now,
      },
      ownerPermissions(ownerUserId),
    );
    const parsedWidget = parseWidget(widget);
    if (!parsedWidget) continue;
    const tile = await databases.createDocument(
      DATABASE_ID,
      DASHBOARD_TILES,
      ID.unique(),
      {
        ownerUserId,
        dashboardId: parsedDashboard.$id,
        surveyId,
        widgetId: parsedWidget.$id,
        layout: JSON.stringify(entry.defaultLayout),
        order: index,
        createdAt: now,
        updatedAt: now,
      },
      ownerPermissions(ownerUserId),
    );
    const parsedTile = parseTile(tile);
    if (parsedTile) tiles.push({ ...parsedTile, widget: parsedWidget });
  }

  return { dashboard: parsedDashboard, tiles, persisted: true };
}

async function readPersistedStudyDashboard(
  ownerUserId: string,
  surveyId: string,
  databases: Databases,
): Promise<StudyDashboard | null> {
  const dashboards = await databases.listDocuments(DATABASE_ID, DASHBOARDS, [
    Query.equal("ownerUserId", ownerUserId),
    Query.equal("surveyId", surveyId),
    Query.equal("scope", "study"),
    Query.orderDesc("updatedAt"),
    Query.limit(1),
  ]);
  const dashboard = parseDashboard(dashboards.documents[0] ?? null);
  if (!dashboard) return null;

  const [tileRows, widgetRows] = await Promise.all([
    databases.listDocuments(DATABASE_ID, DASHBOARD_TILES, [
      Query.equal("ownerUserId", ownerUserId),
      Query.equal("dashboardId", dashboard.$id),
      Query.orderAsc("order"),
      Query.limit(100),
    ]),
    databases.listDocuments(DATABASE_ID, DASHBOARD_WIDGETS, [
      Query.equal("ownerUserId", ownerUserId),
      Query.equal("dashboardId", dashboard.$id),
      Query.limit(100),
    ]),
  ]);

  const widgets = new Map<string, DashboardWidget>();
  for (const row of widgetRows.documents) {
    const widget = parseWidget(row);
    if (widget) widgets.set(widget.$id, widget);
  }

  const tiles: DashboardTileWithWidget[] = [];
  for (const row of tileRows.documents) {
    const tile = parseTile(row);
    const widget = tile ? widgets.get(tile.widgetId) : null;
    if (tile && widget) tiles.push({ ...tile, widget });
  }

  return { dashboard, tiles, persisted: true };
}

export async function getOrCreateStudyDashboard(
  ownerUserId: string,
  surveyId: string,
  title = "研究概览",
  databases: Databases = db(),
): Promise<StudyDashboard> {
  try {
    const existing = await readPersistedStudyDashboard(ownerUserId, surveyId, databases);
    if (existing) return existing;
    return await createDefaultStudyDashboard(ownerUserId, surveyId, title, databases);
  } catch {
    return virtualStudyDashboard(ownerUserId, surveyId, title);
  }
}
