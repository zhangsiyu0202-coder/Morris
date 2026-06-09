import { tool } from "ai";
import { z } from "zod";

import { listStudies } from "@/lib/queries";

import {
  NOT_SIGNED_IN,
  toToolError,
  toolResult,
  type ToolResultEnvelope,
  type ToolErrorArtifact,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";

interface ListStudiesArtifact {
  studies: Array<{
    id: string;
    title: string;
    status: string;
    version: number;
    updatedAt: string;
  }>;
}

/**
 * `listStudies` 工具:列出当前研究员账户下所有调研。
 * 不需要 PageContext (任何页面都可调用),所以不声明 contextPromptTemplate。
 */
export function buildListStudiesTool(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;
  return {
    contextPromptTemplate: undefined as string | undefined,
    spec: tool({
      description:
        "列出当前账户下的所有调研及其状态与样本量。当用户问有哪些调研、或需要先了解上下文再决定调用哪个工具时调用。",
      inputSchema: z.object({}),
      execute: async (): Promise<
        ToolResultEnvelope<ListStudiesArtifact | ToolErrorArtifact>
      > => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const surveys = await listStudies(ownerUserId);
          const artifact: ListStudiesArtifact = {
            studies: surveys.map((s) => ({
              id: s.$id,
              title: s.title,
              status: s.status,
              version: s.version,
              updatedAt: s.updatedAt,
            })),
          };
          return toolResult(`已读取 ${artifact.studies.length} 个调研。`, artifact);
        } catch (err) {
          return toToolError("读取调研列表", err);
        }
      },
    }),
  };
}
