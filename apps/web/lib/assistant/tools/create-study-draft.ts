import { tool } from "ai";
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
import { checkWorkspaceAccess } from "../access-control";

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
 * 工具只做校验 + 落库,不再嵌套一次 LLM 调用)。
 *
 * Approval token 不再出现在 input — 用 AI SDK 6 原生 `needsApproval` 后,
 * 暂停/恢复由 SDK 在 message stream 上跟 `tool-approval-request` /
 * `tool-approval-response` 两个 parts 自动管理, 我们无需自己塞 token。
 */
const InputSchema = SurveyDraftSchema;

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
 * `createStudyDraft` 工具 — 由 Morris 生成结构化提纲,登录态走 AI SDK 6
 * 原生 approval 流, 未登录降级为预览。
 *
 * Approval flow (AI SDK 6 原生):
 *  - `needsApproval: async (_input) => ctx.ownerUserId !== null` — 仅在登录态时
 *    暂停 agent loop, AI SDK 把 `tool-approval-request` part 流到客户端。
 *  - 用户点"批准" → useChat.addToolApprovalResponse({approved:true}) → 服务端
 *    在下次 streamText/agent.stream 时由 `sendAutomaticallyWhen:
 *    lastAssistantMessageIsCompleteWithApprovalResponses` 自动触发, 进入 execute。
 *  - 用户点"拒绝" → approved:false → SDK 跳过 execute, tool-result state=output-denied。
 *  - 不再需要 `approvalToken` 字段、`approvalPreview` 函数、`/api/assistant/confirm`
 *    端点和 `withApprovalGuard` 套壳; UI 直接渲染 `input` (SurveyDraft) 即可生成
 *    预览。参见 https://ai-sdk.dev/cookbook/next/human-in-the-loop。
 *
 * Metadata `destructive` 仍随登录态动态取值, 供 system-prompt manifest 与 UI
 * 描述使用; 真正的暂停/放行由 `needsApproval` 接管, 不再依赖 metadata 推导。
 */
export function buildCreateStudyDraftTool(ctx: AssistantToolContext) {
  const signedIn = ctx.ownerUserId !== null;

  const metadata: ToolMetadata = {
    title: "创建调研",
    description: DESCRIPTION,
    annotations: { readOnly: false, destructive: signedIn, idempotent: false },
    requiredScopes: ["study:editor"],
    type: "write",
    enabled: true,
  };

  return {
    contextPromptTemplate: undefined as string | undefined,
    metadata,
    spec: tool({
      description: DESCRIPTION,
      inputSchema: InputSchema,
      // 仅登录态需要研究员二次确认才会真正写库; 未登录态走预览路径(execute
      // 内自己拦了一次), needsApproval 直接 false 让 AI SDK 不弹 approval UI。
      needsApproval: async () => signedIn,
      execute: async (
        input,
      ): Promise<ToolResultEnvelope<CreatedStudyArtifact | DraftPreviewArtifact | ToolErrorArtifact>> => {
        // 入参 schema 已经在 AI SDK 层用 InputSchema(=SurveyDraftSchema) 校验过,
        // 这里只兜底 superRefine 跨字段约束(zod safeParse 第二次)。
        const parsed = SurveyDraftSchema.safeParse(input);
        if (!parsed.success) {
          return toToolError("创建调研", new Error(parsed.error.issues[0]?.message ?? "提纲格式不合法"));
        }
        const draft = parsed.data;
        const questionCount = draft.sections.reduce((n, s) => n + s.questions.length, 0);

        // robustness-hardening REQ-4: workspace ACL gate. Runs BEFORE the
        // preview branch so a signed-in member without `study:editor` is
        // denied even before we'd offer them a preview. Skipped entirely
        // when ctx.workspace is null (solo / unauthenticated path → preview).
        if (ctx.workspace) {
          const denied = checkWorkspaceAccess(ctx.workspace, {
            toolName: "createStudyDraft",
            requiredScopes: ["study:editor"],
          });
          if (denied) return denied;
        }

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

        // 登录态: needsApproval=true 保证只有研究员明确"批准"后才能到达这里。
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
