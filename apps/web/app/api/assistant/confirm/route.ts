import { z } from "zod";

/**
 * Morris Approval confirm 端点 (R8 / morris-agent-hardening, 占位).
 *
 * 形状契约见 design.md §10.3。当前实现:
 * - schema 校验 → 失败返 `400 invalid_input`
 * - 校验通过 → 返 `501 not_implemented_yet`
 *
 * 真实写动作由消费端 Spec (如 survey-editor) 落地: 按 proposalId 找回 payload,
 * 应用 edits, 调对应 Function。本 Spec 不引入任何危险工具, 因此 confirm 不会
 * 被实际触发, 但端点必须存在以便消费端 Spec 一接就跑。
 */

export const runtime = "nodejs";

const ConfirmSchema = z.object({
  proposalId: z.string().min(1).max(128),
  decision: z.enum(["approve", "reject"]),
  edits: z.record(z.string(), z.unknown()).optional(),
  feedback: z.string().max(500).optional(),
});

export async function POST(req: Request) {
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
  // 占位: 等消费端 Spec (例如 survey-editor) 实现具体写动作。
  return Response.json(
    {
      error: "not_implemented_yet",
      message:
        "Approval confirm 端点骨架已就位, 实际写动作待 survey-editor 等消费端 Spec 接入。",
      received: parsed.data,
    },
    { status: 501 },
  );
}
