import { z } from "zod";
import { SurveyDraftSchema } from "@merism/contracts";
import { createLogger } from "@merism/observability";

import { createSurveyFromDraft } from "@/lib/actions/survey";

/**
 * Morris Approval confirm 端点 (R8 / morris-agent-hardening + survey-editor T11).
 *
 * 形状契约见 morris-agent-hardening design §10.3。两段式 approval 的"确认"回合:
 * 前端 approval 卡片在用户点「批准」时把 `{ proposalId, decision, toolName, payload }`
 * POST 到这里, 由消费端按 toolName 分发到真实写动作。
 *
 * 已接入的写动作:
 * - `createStudyDraft`: payload 校验为 `SurveyDraft` → `createSurveyFromDraft`
 *   (内部经 requireOwnerUserId 鉴权 + 全量落库)。未登录 → 401。
 *
 * 未接入的 toolName 仍返回 501(骨架就位, 等对应消费端 spec)。
 * 校验失败 → 400 invalid_input。reject → 200(不写任何东西)。
 */

export const runtime = "nodejs";

const ConfirmSchema = z.object({
  proposalId: z.string().min(1).max(128),
  decision: z.enum(["approve", "reject"]),
  toolName: z.string().min(1).max(64).optional(),
  // 批准时回流的工具入参(approval 卡片从 pending_approval.payload 原样带回)。
  payload: z.record(z.string(), z.unknown()).optional(),
  edits: z.record(z.string(), z.unknown()).optional(),
  feedback: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const logger = createLogger("action.assistant.confirm");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_input", reason: "请求体不是合法的 JSON。" }, { status: 400 });
  }
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { proposalId, decision, toolName, payload } = parsed.data;

  // 拒绝: 不写任何东西, 让对话继续(Morris 会按 feedback 调整方案)。
  if (decision === "reject") {
    logger.info("approval.rejected", { proposalId, toolName });
    return Response.json({ ok: true, decision: "reject" });
  }

  // 批准: 按 toolName 分发真实写动作。
  if (toolName === "createStudyDraft") {
    const draftParsed = SurveyDraftSchema.safeParse(payload);
    if (!draftParsed.success) {
      return Response.json(
        { error: "invalid_input", reason: "提纲格式不合法。", details: draftParsed.error.flatten() },
        { status: 400 },
      );
    }
    try {
      const { surveyId, url } = await createSurveyFromDraft(draftParsed.data);
      logger.info("approval.approved", { proposalId, toolName, surveyId });
      return Response.json({
        ok: true,
        decision: "approve",
        toolName,
        surveyId,
        url,
        message: `已创建调研「${draftParsed.data.title}」。`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "not_authenticated") {
        return Response.json({ error: "not_authenticated", reason: "请先登录后再创建调研。" }, { status: 401 });
      }
      logger.error("approval.write_failed", { proposalId, toolName, detail: message });
      return Response.json({ error: "internal_error", traceId: logger.traceId }, { status: 500 });
    }
  }

  // 其余 toolName 暂未接入具体写动作。
  logger.warn("approval.not_implemented", { proposalId, toolName: toolName ?? null });
  return Response.json(
    {
      error: "not_implemented_yet",
      message: "该工具的 approval 写动作尚未接入。",
      received: { proposalId, toolName: toolName ?? null },
    },
    { status: 501 },
  );
}
