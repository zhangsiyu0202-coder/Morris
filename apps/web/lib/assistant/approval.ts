import type { StopCondition } from "ai";
import type { AssistantTools } from "./tools";

/**
 * Morris 危险操作 Approval 协议骨架 (R8 / morris-agent-hardening).
 *
 * 设计要点 (借鉴 hogai `_handle_dangerous_operation`, 但 ToolLoopAgent 没有"图暂停"
 * 概念, 改为"工具返回 pending_approval → stopWhen 终止 → 前端单独 confirm 请求"
 * 两次 round-trip 模型, 达到等价语义):
 *
 * 1. 危险工具的 `execute` 在判断为 dangerous 且未携带 approvalToken 时, 调
 *    `proposeApproval(...)` 返回一个 `pending_approval` 形态的 envelope。
 * 2. ToolLoopAgent 的 `stopWhen` 加 `hasPendingApproval` 终止条件, 防止模型
 *    在收到 pending 后继续推理。
 * 3. 前端识别该形态, 渲染确认卡片; 用户操作后调 POST /api/assistant/confirm。
 * 4. 消费端 Spec (如 survey-editor) 实现 confirm 端点的真正写动作。本 Spec 中
 *    confirm 只做 schema 校验后返回 501 not_implemented_yet。
 */

export interface ApprovalEnvelope {
  status: "pending_approval";
  proposalId: string;
  toolName: string;
  /** 给用户阅读的 markdown 预览 (展示"将要做什么 / 影响范围")。 */
  preview: string;
  /** 批准后真正执行所需的入参; 已脱敏。 */
  payload: Record<string, unknown>;
  createdAt: string;
}

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // 退回到弱随机, 仅在不支持 crypto.randomUUID 的运行时 (开发环境) 出现。
  return `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 工具 execute 在判定为危险时返回 ApprovalEnvelope (作为 ToolResultEnvelope 的 artifact)。 */
export function proposeApproval(args: {
  toolName: string;
  preview: string;
  payload: Record<string, unknown>;
}): ApprovalEnvelope {
  return {
    status: "pending_approval",
    proposalId: uuid(),
    toolName: args.toolName,
    preview: args.preview,
    payload: { ...args.payload },
    createdAt: new Date().toISOString(),
  };
}

/** 类型谓词: 这个对象是 pending_approval envelope 形态。给 stopWhen 与前端用。 */
export function isPendingApprovalArtifact(value: unknown): value is ApprovalEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as { status?: unknown; proposalId?: unknown; toolName?: unknown };
  return (
    v.status === "pending_approval" &&
    typeof v.proposalId === "string" &&
    typeof v.toolName === "string"
  );
}

/**
 * stopWhen 条件: 任何工具返回了 pending_approval 形态, 立即停止推理。
 *
 * 工具返回的是 ToolResultEnvelope, 我们既检查顶层 (向后兼容) 又检查 .artifact, 这样
 * 不论 SDK 在 step 上保留的是哪一种摆放都能命中。
 */
export const hasPendingApproval: StopCondition<AssistantTools> = ({ steps }) =>
  steps.some((step) =>
    (step.toolResults ?? []).some((r) => {
      const out = (r as { output?: unknown }).output;
      if (isPendingApprovalArtifact(out)) return true;
      if (out && typeof out === "object") {
        const artifact = (out as { artifact?: unknown }).artifact;
        if (isPendingApprovalArtifact(artifact)) return true;
      }
      return false;
    }),
  );
