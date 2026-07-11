"use client";

import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import type { SurveyDraft } from "@merism/contracts";

/**
 * Morris destructive 工具确认卡片 — AI SDK 6 原生 HITL 形态
 * (https://ai-sdk.dev/cookbook/next/human-in-the-loop)。
 *
 * 由 `conversation.tsx` 在工具 part `state === "approval-requested"` 时渲染。
 * 不发任何 fetch — 用户点击 → 调 props.onApprove() / props.onDeny() →
 * 父组件用 useChat.addToolApprovalResponse 把决定写回, AI SDK 在下一轮
 * sendAutomaticallyWhen 触发服务端续接 execute (批准) 或 skip (拒绝)。
 *
 * 视觉遵循 .kiro/steering/design-system.md (Mauve Quiet):
 *   - 批准 button = primary (mauve-200 填充 + ink-900 文字)
 *   - 拒绝 button = outline (white 填充 + ink-900 边框)
 *   - 拒绝时可附 reason (透传给 LLM 让它调整方案)
 */

interface ApprovalCardProps {
  toolName: string;
  input: unknown;
  onApprove: () => void;
  onDeny: (reason?: string) => void;
}

export function ApprovalCard({ toolName, input, onApprove, onDeny }: ApprovalCardProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const preview = renderPreviewMarkdown(toolName, input);

  function handleApprove() {
    setSubmitting(true);
    onApprove();
  }

  function handleDeny() {
    setSubmitting(true);
    onDeny(reason.trim() || undefined);
  }

  return (
    <div className="rounded-md border border-ink-200 bg-ink-0 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-ink-900">
        <AlertTriangle size={18} />
        <span className="font-ui text-body-sm font-semibold">需要您确认: {labelFor(toolName)}</span>
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto rounded-sm bg-mauve-50 p-3 font-reading text-body-sm leading-6 text-ink-800 whitespace-pre-wrap">
        {preview}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={submitting}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-mauve-200 px-4 text-body-sm font-medium text-ink-900 transition hover:bg-mauve-100 disabled:opacity-50"
        >
          <Check size={16} /> 批准
        </button>
        <button
          type="button"
          onClick={handleDeny}
          disabled={submitting}
          className="inline-flex h-9 items-center gap-1.5 rounded border border-ink-900 bg-ink-0 px-4 text-body-sm font-medium text-ink-900 transition hover:bg-mauve-50 disabled:opacity-50"
        >
          <X size={16} /> 拒绝
        </button>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="可选反馈 (拒绝时附上原因)"
          className="ml-2 h-9 flex-1 rounded border border-ink-200 bg-ink-0 px-3 text-body-sm text-ink-900 placeholder:text-ink-400"
          maxLength={500}
          disabled={submitting}
        />
      </div>
    </div>
  );
}

/** "createStudyDraft" → "创建调研" 等用户可读名。新增 destructive 工具时同步这里。 */
function labelFor(toolName: string): string {
  switch (toolName) {
    case "createStudyDraft":
      return "创建调研";
    case "manageMemories":
      return "删除长期记忆";
    default:
      return toolName;
  }
}

/**
 * 把 tool input 渲染成人读 markdown / 纯文本 preview。每个 destructive 工具
 * 自己一段; 未注册的 toolName 走 JSON dump fallback (不应该在生产路径上发生)。
 */
function renderPreviewMarkdown(toolName: string, input: unknown): string {
  if (toolName === "createStudyDraft") {
    return renderCreateStudyDraftPreview(input as SurveyDraft);
  }
  if (toolName === "manageMemories") {
    return renderManageMemoriesPreview(input);
  }
  // Fallback — JSON stringified, capped to avoid pathological lengths.
  try {
    return JSON.stringify(input, null, 2).slice(0, 2000);
  } catch {
    return String(input);
  }
}

function renderCreateStudyDraftPreview(draft: SurveyDraft): string {
  const questionCount = draft.sections.reduce((n, s) => n + s.questions.length, 0);
  const sectionLines = draft.sections
    .map((s, i) => {
      const qs = s.questions.map((q, j) => `   ${j + 1}. ${q.questionText}`).join("\n");
      return `${i + 1}. ${s.title} — ${s.objective}\n${qs}`;
    })
    .join("\n\n");
  return (
    `将创建调研「${draft.title}」并保存提纲(${draft.sections.length} 节、${questionCount} 个问题)。\n\n` +
    `- 研究目标:${draft.researchGoal}\n` +
    `- 目标人群:${draft.targetAudience}\n\n` +
    sectionLines
  );
}

/**
 * manageMemories 仅在 `action === "delete"` 时触发 approval (per ADR-0009 +
 * `tools/manage-memories.ts` 的 needsApproval), 所以只渲染 delete preview。
 * 其他 action 也走到这里的话, fallback 到 JSON 即可。
 */
function renderManageMemoriesPreview(input: unknown): string {
  const obj = input as { action?: string; memoryId?: string };
  if (obj?.action === "delete" && obj.memoryId) {
    return (
      `将永久删除一条长期记忆 (memoryId=${obj.memoryId})。\n\n` +
      `此操作不可撤销; 已存于记忆中的相关事实在删除后不再被 Morris 自动取用。`
    );
  }
  try {
    return JSON.stringify(input, null, 2).slice(0, 2000);
  } catch {
    return String(input);
  }
}
