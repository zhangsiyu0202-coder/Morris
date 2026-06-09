import { tool } from "ai";
import { z } from "zod";

import { searchTranscriptSegments } from "@/lib/queries";

import {
  NOT_SIGNED_IN,
  toToolError,
  toolResult,
  type ToolErrorArtifact,
  type ToolResultEnvelope,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";

interface SearchArtifact {
  count: number;
  snippets: Array<{
    sessionId: string;
    transcriptId: string;
    segmentIndex: number;
    speaker: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
}

/**
 * `searchInterviewData` 工具:在指定调研的 transcript 中检索受访者原话。
 *
 * `contextPromptTemplate` (R2): 让模型在用户没明确指定 studyId 时,优先用
 * PageContext 中的 `surveyId` (即"我们正坐在哪个调研页"),提升调用准确率。
 */
export function buildSearchInterviewDataTool(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;
  return {
    contextPromptTemplate:
      "当前页面: {path}. 主调研: {surveyId}. 若用户未指定 studyId, 优先用 surveyId.",
    spec: tool({
      description:
        "在已有访谈记录中检索与关键词相关的受访者回答片段。当用户想了解受访者具体说了什么、查找原话或某类反馈时调用。需要 studyId 限定到具体调研。",
      inputSchema: z.object({
        query: z.string().describe("检索关键词,可为空字符串以返回全部"),
        studyId: z.string().describe("要检索的调研 id (必填,不限定调研时无法跨调研检索)"),
      }),
      execute: async ({
        query,
        studyId,
      }): Promise<ToolResultEnvelope<SearchArtifact | ToolErrorArtifact>> => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const hits = await searchTranscriptSegments(ownerUserId, {
            query: query ?? "",
            surveyId: studyId,
            limit: 20,
          });
          const artifact: SearchArtifact = {
            count: hits.length,
            snippets: hits.map((h) => ({
              sessionId: h.sessionId,
              transcriptId: h.transcriptId,
              segmentIndex: h.segmentIndex,
              speaker: h.speaker,
              text: h.text,
              startMs: h.startMs,
              endMs: h.endMs,
            })),
          };
          return toolResult(
            `在调研 ${studyId} 中检索到 ${artifact.count} 条访谈片段。`,
            artifact,
          );
        } catch (err) {
          return toToolError("检索访谈数据", err);
        }
      },
    }),
  };
}
