import { tool } from "ai";
import { z } from "zod";

import { listStudies } from "@/lib/queries";
import { scopeForOwner } from "@/lib/auth/workspace";

import {
  NOT_SIGNED_IN,
  toToolError,
  toolResult,
  type ToolResultEnvelope,
  type ToolErrorArtifact,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";
import type { ToolMetadata } from "../tool-metadata";

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
  const metadata: ToolMetadata = {
    title: "列出调研",
    description:
      "列出当前账户下的所有调研及其状态与样本量。" +
      "当用户问'我有哪些调研'、或需要先了解上下文再决定调用哪个工具 (analyzeData / searchInterviewData) 时调用。" +
      "无入参 (空 zod object)。返回的 artifact.studies 数组每项含 id / title / status / version / updatedAt, 可直接用于后续工具的 studyId 入参串联。",
    annotations: { readOnly: true, destructive: false, idempotent: true },
    requiredScopes: ["study:read"],
    type: "read",
    enabled: true,
  };
  return {
    contextPromptTemplate: undefined as string | undefined,
    metadata,
    spec: tool({
      description:
        "列出当前账户下的所有调研及其状态与样本量。" +
        "当用户问'我有哪些调研'、或需要先了解上下文再决定调用哪个工具 (analyzeData / searchInterviewData) 时调用。" +
        "无入参 (空 zod object)。返回的 artifact.studies 数组每项含 id / title / status / version / updatedAt, 可直接用于后续工具的 studyId 入参串联。",
      inputSchema: z.object({}),
      execute: async (): Promise<
        ToolResultEnvelope<ListStudiesArtifact | ToolErrorArtifact>
      > => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const surveys = await listStudies(await scopeForOwner(ownerUserId));
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
