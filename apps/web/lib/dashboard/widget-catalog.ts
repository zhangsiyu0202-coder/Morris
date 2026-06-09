import type { DashboardTileLayout, DashboardWidgetType } from "@merism/contracts";

export type DashboardWidgetCatalogEntry = {
  widgetType: DashboardWidgetType;
  groupId: string;
  groupLabel: string;
  label: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  defaultLayout: DashboardTileLayout;
};

export const DASHBOARD_WIDGET_CATALOG = {
  study_progress: {
    widgetType: "study_progress",
    groupId: "study",
    groupLabel: "调研",
    label: "完成进度",
    description: "显示总会话数、完成数和完成率。",
    defaultConfig: {},
    defaultLayout: { x: 0, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  },
  recent_sessions: {
    widgetType: "recent_sessions",
    groupId: "sessions",
    groupLabel: "访谈",
    label: "最近访谈",
    description: "列出最近进入项目的访谈会话。",
    defaultConfig: { limit: 6 },
    defaultLayout: { x: 4, y: 0, w: 8, h: 4, minW: 4, minH: 3 },
  },
  top_themes: {
    widgetType: "top_themes",
    groupId: "analysis",
    groupLabel: "分析",
    label: "核心主题",
    description: "展示 survey-level 报告中的高频主题。",
    defaultConfig: { limit: 5 },
    defaultLayout: { x: 0, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
  },
  top_insights: {
    widgetType: "top_insights",
    groupId: "analysis",
    groupLabel: "分析",
    label: "关键洞察",
    description: "展示整体报告中的关键洞察结论。",
    defaultConfig: { limit: 4 },
    defaultLayout: { x: 6, y: 4, w: 6, h: 4, minW: 4, minH: 3 },
  },
  sentiment_breakdown: {
    widgetType: "sentiment_breakdown",
    groupId: "analysis",
    groupLabel: "分析",
    label: "情绪分布",
    description: "显示整体报告中的正向、中性、负向分布。",
    defaultConfig: {},
    defaultLayout: { x: 0, y: 6, w: 4, h: 3, minW: 3, minH: 3 },
  },
  bookmarked_quotes: {
    widgetType: "bookmarked_quotes",
    groupId: "evidence",
    groupLabel: "证据",
    label: "收藏原话",
    description: "展示研究员收藏的访谈片段。",
    defaultConfig: { limit: 5 },
    defaultLayout: { x: 4, y: 8, w: 8, h: 4, minW: 4, minH: 3 },
  },
  visual_moments: {
    widgetType: "visual_moments",
    groupId: "video",
    groupLabel: "视频",
    label: "视频关键时刻",
    description: "展示录屏多模态分析识别的关键时刻。",
    defaultConfig: { limit: 5 },
    defaultLayout: { x: 0, y: 9, w: 6, h: 4, minW: 4, minH: 3 },
  },
  question_stats: {
    widgetType: "question_stats",
    groupId: "analysis",
    groupLabel: "分析",
    label: "问题统计",
    description: "展示结构化问题的聚合统计。",
    defaultConfig: { limit: 6 },
    defaultLayout: { x: 6, y: 12, w: 6, h: 4, minW: 4, minH: 3 },
  },
} satisfies Record<DashboardWidgetType, DashboardWidgetCatalogEntry>;

export const STUDY_OVERVIEW_PRESET_ID = "study_overview";

export const STUDY_OVERVIEW_WIDGET_TYPES: DashboardWidgetType[] = [
  "study_progress",
  "recent_sessions",
  "top_themes",
  "top_insights",
  "sentiment_breakdown",
  "bookmarked_quotes",
  "visual_moments",
  "question_stats",
];

export function getDashboardWidgetCatalogEntry(
  widgetType: DashboardWidgetType,
): DashboardWidgetCatalogEntry {
  return DASHBOARD_WIDGET_CATALOG[widgetType];
}
