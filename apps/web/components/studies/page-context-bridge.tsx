"use client";

import { useEffect } from "react";

import { usePageContextSetter } from "@/components/assistant/page-context-provider";

/**
 * 不渲染任何 DOM 的 bridge 组件:把当前调研的 `surveyId` 写入 Morris 的
 * PageContext, 供路由层在 system prompt 渲染 `<page_context>` / `<tool_context>`
 * 时使用。当组件卸载或 surveyId 变化时清除。
 */
export function StudyPageContextBridge({ surveyId }: { surveyId: string }) {
  const { set } = usePageContextSetter();

  useEffect(() => {
    set({ surveyId });
    return () => set({ surveyId: undefined });
  }, [surveyId, set]);

  return null;
}
