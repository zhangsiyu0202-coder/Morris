import { tool } from "ai";
import { CreateNotebookRequestSchema } from "@merism/contracts";

import {
  NOT_SIGNED_IN,
  toToolError,
  toolResult,
  type ToolErrorArtifact,
  type ToolResultEnvelope,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";
import {
  saveNotebookFromMarkdown,
  type SaveNotebookResult,
} from "@/lib/server/notebooks";
import { getStudy } from "@/lib/queries";

interface CreateNotebookArtifact {
  notebookShortId: string;
  $id: string;
  studyId: string;
  question: string;
  sectionCount: number;
  /** "created" — D10 决策无 update 路径, status 字段保留是为未来扩展不破坏 API. */
  status: "created";
}

/**
 * `createNotebook` 工具 (Wave D, R4 / design §8.1).
 *
 * Morris 在研究员请求"针对这个 study 给我分析 X" / "把上面对话总结成 notebook"
 * 等场景下调用。input.content (Markdown 字符串) 是主路径; input.draftContent
 * 是"先想再写"草稿不流式给前端用。两者互斥 (CreateNotebookRequestSchema
 * 在 contracts 处用 .refine 强制).
 *
 * D10 决策: 永远 create 一份**新** Notebook, 不存在 update existing 路径。
 * 研究员不满意时让 Morris 重新生成新一份, 旧 Notebook 保留可在 /notebooks
 * 列表删除。
 *
 * 流式行为: AI SDK toolCallStreaming 把 input.content 增量 chunk 给前端
 * (conversation.tsx 监听 onChunk 增量 markdownToProseMirror 解析渲染预览),
 * 但 execute 一次性收到完整 input.content 后才落库 + 返回 envelope。
 * Embedding 在 saveNotebookFromMarkdown 内部 stream 结束后一次性生成
 * (Wave E T38 接通; B1 修订)。
 */
export function buildCreateNotebookTool(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;
  return {
    contextPromptTemplate: `当前 study 上下文 (PageContext.surveyId 自动注入到工具入参 studyId):
- studyId: {surveyId}

调用前 Morris 已确认 ownerUserId / studyId 都有效。`,
    spec: tool({
      description:
        "把当前对话或分析结果保存为一份新的 Notebook (研究员的洞察文档)。" +
        "input.content 接受 Markdown 字符串 (允许嵌入 <merism-quote/> / " +
        "<merism-theme/> 等 8 类自定义 tag), 系统会自动转为 ProseMirror " +
        "JSON 落库。**永远 create 新一份**, 不更新已有 notebook (研究员不满意" +
        "时让 Morris 重新生成新一份)。返回 notebookShortId 用于 /notebooks/{shortId} 跳转。",
      inputSchema: CreateNotebookRequestSchema,
      execute: async (
        input,
      ): Promise<ToolResultEnvelope<CreateNotebookArtifact | ToolErrorArtifact>> => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          // draftContent → 不落库, 只做 echo (Morris 内部"先想再写"草稿)
          if (input.draftContent !== undefined) {
            return toolResult(
              "已记录草稿 (未落库)。继续完善后调用 createNotebook 时改为 content 字段触发实际保存。",
              {
                notebookShortId: "",
                $id: "",
                studyId: input.studyId,
                question: input.question,
                sectionCount: 0,
                status: "created" as const,
              },
            );
          }

          // content path: 校验 study, 落库, 返回 shortId
          const study = await getStudy(ownerUserId, input.studyId);
          if (!study) {
            return toToolError(
              "保存 Notebook",
              new Error(`未找到 studyId=${input.studyId}, 或不属于当前账户`),
            );
          }

          const result: SaveNotebookResult = await saveNotebookFromMarkdown({
            ownerUserId,
            studyId: input.studyId,
            studyTitle: study.survey.title,
            question: input.question,
            markdown: input.content ?? "",
          });

          const artifact: CreateNotebookArtifact = {
            notebookShortId: result.shortId,
            $id: result.$id,
            studyId: input.studyId,
            question: input.question,
            sectionCount: result.sectionCount,
            status: "created",
          };
          return toolResult(
            `已创建 Notebook (shortId=${result.shortId}, 含 ${result.sectionCount} 个章节)。` +
              `研究员可在 /notebooks/${result.shortId} 查看完整内容。`,
            artifact,
          );
        } catch (err) {
          return toToolError("创建 Notebook", err);
        }
      },
    }),
  };
}
