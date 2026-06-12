import { tool } from "ai";
import { z } from "zod";
import { SurveyDraftSchema, type SurveyDraft } from "@merism/contracts";

import { createSurveyFromDraft } from "@/lib/actions/survey";
import {
  toToolError,
  toolResult,
  type ToolErrorArtifact,
  type ToolResultEnvelope,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";
import type { ToolMetadata } from "../tool-metadata";

/** 落库成功后的 artifact:给 UI 渲染「已创建」卡片 + 深链。 */
interface CreatedStudyArtifact {
  persisted: true;
  surveyId: string;
  url: string;
  title: string;
  sectionCount: number;
  questionCount: number;
}

/** 未登录降级:只回草稿预览,不写 Appwrite。 */
interface DraftPreviewArtifact {
  persisted: false;
  draft: SurveyDraft;
  note: string;
}

/**
 * 工具入参 = 完整 `SurveyDraft`(由 Morris 自己生成,借鉴 PostHog Max
 * `create_user_interview_topic`:外层 agent 直接产出结构化提纲作为工具入参,
 * 工具只做校验 + 落库,不再嵌套一次 LLM 调用)。`approvalToken` 由 confirm
 * 端点回流时携带(withApprovalGuard 读它)。
 */
const InputSchema = SurveyDraftSchema.extend({
  approvalToken: z.string().optional(),
});

const DESCRIPTION =
  "根据研究目标创建一份完整的访谈调研提纲并保存。\n" +
  "# 何时调用\n" +
  "- 用户说「帮我设计/创建一个调研」「我想了解 X 是怎么做的」「访谈用户搞清楚 Y」时。\n" +
  "# 你要生成什么\n" +
  "- 一份结构化 SurveyDraft:标题、研究目标(researchGoal)、目标人群(targetAudience)、" +
  "开场白(introScript)、若干 section(每节含 title/objective 与 3-6 个开放式问题)。\n" +
  "- 问题要贴合 goal、口语化、开放式,避免诱导性或是非题;按要问的顺序排列。\n" +
  "- 选择题(single_choice/multi_choice/ranking)必须给至少两个 options。\n" +
  "# 重要\n" +
  "- 这是访谈「调研提纲」(Survey),不是 Notebook 报告,也不是 NPS/打分问卷小组件。\n" +
  "- 不要凭空捏造研究背景:研究目标 / 目标人群不清楚时,先向用户追问,再生成提纲。\n" +
  "- 登录后调用会真正在 Appwrite 创建 Survey(需研究员确认);未登录只返回预览不落库。";

/**
 * `createStudyDraft` 工具:由 Morris 生成结构化提纲,登录则落库(走 approval),
 * 未登录降级为预览。
 *
 * - `annotations.destructive` 随登录态动态取值:未登录 false(identity guard →
 *   直接走 execute 出预览);登录 true(withApprovalGuard 拦截 → 研究员确认 →
 *   confirm 端点 `createSurveyFromDraft` 落库)。
 * - 不依赖 contextPromptTemplate(与具体页面无关)。
 */
export function buildCreateStudyDraftTool(ctx: AssistantToolContext) {
  const signedIn = ctx.ownerUserId !== null;

  const metadata: ToolMetadata = {
    title: "创建调研",
    description: DESCRIPTION,
    annotations: { readOnly: false, destructive: signedIn, idempotent: false },
    requiredScopes: ["survey:write"],
    type: "write",
    enabled: true,
  };

  /** 给 approval 卡片的人读预览(withApprovalGuard 在登录态拦截时调用)。 */
  function approvalPreview(input: z.infer<typeof InputSchema>): string {
    const sectionLines = input.sections
      .map((s, i) => {
        const qs = s.questions.map((q, j) => `   ${j + 1}. ${q.questionText}`).join("\n");
        return `**${i + 1}. ${s.title}** — ${s.objective}\n${qs}`;
      })
      .join("\n\n");
    const questionCount = input.sections.reduce((n, s) => n + s.questions.length, 0);
    return (
      `将创建调研「**${input.title}**」并保存提纲(${input.sections.length} 节、${questionCount} 个问题)。\n\n` +
      `- 研究目标:${input.researchGoal}\n` +
      `- 目标人群:${input.targetAudience}\n\n` +
      sectionLines
    );
  }

  return {
    contextPromptTemplate: undefined as string | undefined,
    metadata,
    approvalPreview,
    spec: tool({
      description: DESCRIPTION,
      inputSchema: InputSchema,
      execute: async (
        input,
      ): Promise<ToolResultEnvelope<CreatedStudyArtifact | DraftPreviewArtifact | ToolErrorArtifact>> => {
        // 入参校验(剥离 approvalToken 后按 SurveyDraft 校验,含 superRefine 不变量)。
        const { approvalToken: _approvalToken, ...draftInput } = input;
        const parsed = SurveyDraftSchema.safeParse(draftInput);
        if (!parsed.success) {
          return toToolError("创建调研", new Error(parsed.error.issues[0]?.message ?? "提纲格式不合法"));
        }
        const draft = parsed.data;
        const questionCount = draft.sections.reduce((n, s) => n + s.questions.length, 0);

        // 未登录降级:只回预览,不落库(保留免登录可用)。
        if (ctx.ownerUserId === null) {
          return toolResult(
            `已生成调研「${draft.title}」草稿预览(${draft.sections.length} 节、${questionCount} 个问题)。` +
              `未登录,尚未保存;登录后我可以帮你正式创建。`,
            {
              persisted: false,
              draft,
              note: "未登录,仅预览未写入 Appwrite。",
            } satisfies DraftPreviewArtifact,
          );
        }

        // 登录态:此处仅在 confirm 端点回流(携带 approvalToken)时被 withApprovalGuard
        // 放行执行;正常 UI 路径由 /api/assistant/confirm 直接调 createSurveyFromDraft。
        try {
          const { surveyId, url } = await createSurveyFromDraft(draft);
          return toolResult(
            `已创建调研「${draft.title}」(${draft.sections.length} 节、${questionCount} 个问题)。打开 ${url} 继续编辑。`,
            {
              persisted: true,
              surveyId,
              url,
              title: draft.title,
              sectionCount: draft.sections.length,
              questionCount,
            } satisfies CreatedStudyArtifact,
          );
        } catch (err) {
          return toToolError("创建调研", err);
        }
      },
    }),
  };
}
