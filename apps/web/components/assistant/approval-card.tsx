"use client";

import { useState } from "react";
import { AlertTriangle, Check, X, Loader2 } from "lucide-react";

import { Markdown } from "./markdown";

/**
 * Morris 危险操作确认卡 (R8 / morris-agent-hardening, 占位).
 *
 * 渲染规则:
 * - 在 ToolResult 流里识别 `artifact.status === "pending_approval"` (见 ./tool-results.tsx
 *   的接线点)。
 * - 视觉遵循 .kiro/steering/design-system.md (Mauve Quiet):
 *   primary 用 mauve-200 填充 (批准), 拒绝用 outline + ink-900 边框, 二次确认走 Dialog。
 * - 用户操作 → fetch /api/assistant/confirm。当前端点返 501 → UI 渲染"功能待实施"提示,
 *   不破坏对话 (R8 骨架阶段)。
 *
 * 本组件不直接判断"危险"语义, 只渲染 envelope; 消费端 Spec 接入时不需要改这里。
 */

export interface ApprovalCardProps {
  proposalId: string;
  toolName: string;
  preview: string;
  payload: Record<string, unknown>;
}

type Phase = "idle" | "submitting" | "approved" | "rejected" | "error";

export function ApprovalCard({ proposalId, toolName, preview }: ApprovalCardProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [feedback, setFeedback] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function send(decision: "approve" | "reject") {
    setPhase("submitting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/assistant/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId,
          decision,
          ...(decision === "reject" && feedback.trim() ? { feedback: feedback.trim() } : {}),
        }),
      });
      if (res.status === 501) {
        // 占位阶段: 端点已就位但写动作待消费端 Spec 接入。
        setPhase("error");
        setErrorMsg(
          "Approval confirm 端点尚未接入具体写动作 (本 Spec 仅落骨架, 待 survey-editor 子 spec 落地)。",
        );
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPhase("error");
        setErrorMsg(typeof data?.error === "string" ? data.error : "confirm 请求失败");
        return;
      }
      setPhase(decision === "approve" ? "approved" : "rejected");
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const submitting = phase === "submitting";
  const finished = phase === "approved" || phase === "rejected";

  return (
    <div className="rounded-md border border-ink-200 bg-ink-0 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-ink-900">
        <AlertTriangle size={18} />
        <span className="font-ui text-body-sm font-semibold">需要您确认: {toolName}</span>
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto rounded-sm bg-mauve-50 p-3 font-reading text-body-sm text-ink-800">
        <Markdown>{preview}</Markdown>
      </div>

      {phase === "idle" && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => send("approve")}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-mauve-200 px-4 text-body-sm font-medium text-ink-900 transition hover:bg-mauve-100 disabled:opacity-50"
            disabled={submitting}
          >
            <Check size={16} /> 批准
          </button>
          <button
            type="button"
            onClick={() => send("reject")}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-ink-900 bg-ink-0 px-4 text-body-sm font-medium text-ink-900 transition hover:bg-mauve-50 disabled:opacity-50"
            disabled={submitting}
          >
            <X size={16} /> 拒绝
          </button>
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="可选反馈 (拒绝时附上原因)"
            className="ml-2 h-9 flex-1 rounded border border-ink-200 bg-ink-0 px-3 text-body-sm text-ink-900 placeholder:text-ink-400"
            maxLength={500}
          />
        </div>
      )}

      {submitting && (
        <div className="mt-3 flex items-center gap-2 text-ink-600">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-body-sm">正在提交…</span>
        </div>
      )}

      {phase === "approved" && (
        <p className="mt-3 text-body-sm text-ink-900">已批准。Morris 将继续执行此操作。</p>
      )}
      {phase === "rejected" && (
        <p className="mt-3 text-body-sm text-ink-900">已拒绝。可继续与 Morris 对话, 它会调整方案。</p>
      )}
      {phase === "error" && errorMsg && (
        <p className="mt-3 text-body-sm text-ink-900">⚠️ {errorMsg}</p>
      )}

      {finished && (
        <p className="mt-2 text-caption text-ink-400">proposalId: {proposalId}</p>
      )}
    </div>
  );
}
