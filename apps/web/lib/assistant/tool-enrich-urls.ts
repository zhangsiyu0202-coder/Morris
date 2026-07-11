/**
 * Client-safe 视图: toolName -> enrichUrl 模板 (Wave E T21 / morris-tool-metadata R5).
 *
 * 现在由 `tool-catalog.ts` 作为单一静态源头生成。
 */

import { TOOL_CATALOG } from "./tool-catalog";

export const TOOL_ENRICH_URLS: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  Object.entries(TOOL_CATALOG).map(([toolName, entry]) => [toolName, entry.enrichUrl]),
);
