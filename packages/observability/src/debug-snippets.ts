/**
 * Debug snippets extraction (R4 / R7).
 *
 * 默认 LLMCallEvent **不** 含 prompt / completion 文本 (secret masking).
 * 仅当 env `MERISM_DEBUG_PROVIDERS=== "1"` 时, 截首 200 字符塞入 debugSnippets.
 *
 * 严格 "1" — 任何其他值 (包括 "true" / "yes" / "0" / undefined) 都视为关闭.
 * 这与 `errors-and-observability.md::Provider adapter rules` 一致.
 */

const DEBUG_FLAG = "1";
const SNIPPET_MAX = 200;

export interface DebugSnippetsInput {
  prompt?: string;
  completion?: string;
}

export interface DebugSnippets {
  promptHead?: string;
  completionHead?: string;
}

function isDebugEnabled(): boolean {
  return process.env.MERISM_DEBUG_PROVIDERS === DEBUG_FLAG;
}

/**
 * Extract debug snippets honoring `MERISM_DEBUG_PROVIDERS` env gate.
 *
 * - env unset / "0" / "true" / 任何非 "1" → returns undefined
 * - env "1" → 返回各字段截首 SNIPPET_MAX 字符的 head; 没填的字段不放进 result
 * - 全部字段都没填 (空 prompt + 空 completion) → returns undefined
 *
 * K-LLMOBS-09 三态测试覆盖.
 */
export function extractDebugSnippets(
  input: DebugSnippetsInput,
): DebugSnippets | undefined {
  if (!isDebugEnabled()) return undefined;
  const out: DebugSnippets = {};
  if (input.prompt) out.promptHead = input.prompt.slice(0, SNIPPET_MAX);
  if (input.completion) out.completionHead = input.completion.slice(0, SNIPPET_MAX);
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

/** 暴露给测试用 (避免重复魔数). */
export const DEBUG_SNIPPET_MAX_CHARS = SNIPPET_MAX;
