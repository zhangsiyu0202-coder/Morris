/**
 * Morris 工具结果统一信封 (R1 / morris-agent-hardening).
 *
 * 所有 Morris 工具的 `execute` 必须返回 ToolResultEnvelope<T>,失败时 artifact
 * 收紧为 ToolErrorArtifact (`{ error: true; message }`)。
 *
 * 这一层确保:
 * - 模型上下文里看到的永远是 envelope, 不会有原始异常冒泡;
 * - 前端 UI 卡片可以靠 `artifact.error === true` 一处判分支;
 * - 后续工具串联时, 上一步的 artifact 直接给下一步的入参用 (UIPayload 也用同一份)。
 */

export type ToolErrorArtifact = { readonly error: true; readonly message: string };

export type ToolResultEnvelope<TArtifact> = {
  readonly content: string;
  readonly artifact: TArtifact | ToolErrorArtifact;
};

/** 构造一条成功 envelope。`content` 给模型解读, `artifact` 给 UI/后续工具用。 */
export function toolResult<TArtifact>(
  content: string,
  artifact: TArtifact,
): ToolResultEnvelope<TArtifact> {
  return { content, artifact };
}

/** 把任意异常转成失败 envelope。绝不读 stack, 防泄漏。 */
export function toToolError(label: string, err: unknown): ToolResultEnvelope<ToolErrorArtifact> {
  const detail = err instanceof Error ? err.message : String(err);
  const message = `${label}失败:${detail}`;
  return { content: message, artifact: { error: true, message } };
}

/** 未登录用户调读类工具时的统一短路结果。frozen 单例。 */
export const NOT_SIGNED_IN: ToolResultEnvelope<ToolErrorArtifact> = Object.freeze({
  content: "请先登录后再使用研究助手的检索/分析能力。",
  artifact: Object.freeze({
    error: true,
    message: "请先登录后再使用研究助手的检索/分析能力。",
  }),
}) as ToolResultEnvelope<ToolErrorArtifact>;

/** 这个 envelope 是否表示失败 (artifact.error === true)。 */
export function isToolError(envelope: ToolResultEnvelope<unknown>): boolean {
  const a = envelope.artifact as { error?: unknown } | null | undefined;
  return Boolean(a && typeof a === "object" && a.error === true);
}
