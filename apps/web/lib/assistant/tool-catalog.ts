export const TOOL_CATALOG = {
  listStudies: { enrichUrl: undefined, enrichLabel: "查看" },
  searchInterviewData: { enrichUrl: undefined, enrichLabel: "查看" },
  analyzeData: { enrichUrl: "/reports/{surveyId}", enrichLabel: "查看完整报告" },
  createStudyDraft: { enrichUrl: undefined, enrichLabel: "查看" },
  createNotebook: { enrichUrl: "/notebooks/{notebookShortId}", enrichLabel: "查看 Notebook" },
  searchAcrossStudies: { enrichUrl: undefined, enrichLabel: "查看" },
  todoWrite: { enrichUrl: undefined, enrichLabel: "查看" },
  manageMemories: { enrichUrl: undefined, enrichLabel: "查看" },
} as const;

export type ToolName = keyof typeof TOOL_CATALOG;

export function toolEnrichUrl(toolName: ToolName): string | undefined {
  return TOOL_CATALOG[toolName].enrichUrl;
}

export function toolEnrichLabel(toolName: ToolName): string {
  return TOOL_CATALOG[toolName].enrichLabel;
}
