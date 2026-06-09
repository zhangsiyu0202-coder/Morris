/**
 * Morris 对话压缩 (R6 / morris-agent-hardening).
 *
 * 借鉴 hogai `core/agent_modes/compaction_manager.py` 的 plan + apply 两段式:
 * - `planCompaction` 是纯函数, 决定"丢哪些 / 保哪些 / 是否需要摘要"。
 * - `applyCompaction` 处理副作用(调用 summarizer LLM, 失败回退)。
 *
 * 替换原先 `agent.ts::prepareStep` 中的硬截断 (`messages.length > 24 → slice(-16)`),
 * 让早期对话以摘要形式可读, 而非整段丢弃。
 */

import type { UIMessage } from "ai";
import { generateText } from "ai";

import { CHAT_MODEL } from "./model";

// ---------------- Token 估算 ----------------

const APPROX_CHARS_PER_TOKEN = 4;

function partTextLength(part: { type: string; text?: string }): number {
  // 只统计纯文本与 reasoning, 工具结果 / 文件等忽略 (给 token 估算留余量)。
  if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
    return part.text.length;
  }
  return 0;
}

/** 估算一组 UIMessage 的总 token 数。误差可接受, 不调任何 LLM。 */
export function estimateTokens(messages: ReadonlyArray<UIMessage>): number {
  let chars = 0;
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      chars += partTextLength(p as { type: string; text?: string });
    }
  }
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

/** 数有几个 user (human) turn。 */
export function countHumanTurns(messages: ReadonlyArray<UIMessage>): number {
  return messages.filter((m) => m.role === "user").length;
}

// ---------------- planCompaction ----------------

export interface CompactionOpts {
  /** 总 token 预算 (system prompt 之外的预算估算)。 */
  tokenBudget: number;
  /** ≤ 这个数的 user turn 不压缩 (避免在很短对话上做无意义摘要)。 */
  minKeepTurns: number;
  /** 压缩时保留尾部 N 条 messages。 */
  tailKeep: number;
}

export type CompactionPlan =
  | { action: "noop" }
  | {
      action: "compact";
      keep: UIMessage[];
      dropped: UIMessage[];
      needSummary: true;
    };

/** 决定是否压缩。纯函数, 无副作用。 */
export function planCompaction(
  messages: ReadonlyArray<UIMessage>,
  opts: CompactionOpts,
): CompactionPlan {
  if (countHumanTurns(messages) <= opts.minKeepTurns) {
    return { action: "noop" };
  }
  if (estimateTokens(messages) <= opts.tokenBudget) {
    return { action: "noop" };
  }
  if (messages.length <= opts.tailKeep) {
    // tailKeep 已经覆盖整段,继续压缩没意义。
    return { action: "noop" };
  }
  const keep = messages.slice(-opts.tailKeep);
  const dropped = messages.slice(0, -opts.tailKeep);
  return { action: "compact", keep, dropped, needSummary: true };
}

// ---------------- Apply ----------------

export interface Summarizer {
  (messages: ReadonlyArray<UIMessage>): Promise<string>;
}

const FALLBACK_SUMMARY = "(早期对话已省略, 摘要器暂不可用)";

function makeSummaryMessage(content: string): UIMessage {
  return {
    id: `summary-${(globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
    role: "system",
    parts: [{ type: "text", text: content }],
  } as UIMessage;
}

/**
 * 应用压缩计划。失败 → fallback "(早期对话已省略)"; 永不抛。
 *
 * `noop` 时返回原引用 (== 比较为 true), 方便 prepareStep 判定是否需要更新 messages。
 */
export async function applyCompaction(
  messages: ReadonlyArray<UIMessage>,
  plan: CompactionPlan,
  summarizer: Summarizer,
): Promise<ReadonlyArray<UIMessage>> {
  if (plan.action === "noop") return messages;
  let summaryText: string;
  try {
    const result = await summarizer(plan.dropped);
    summaryText = result?.trim() ? result.trim() : FALLBACK_SUMMARY;
  } catch (err) {
    console.warn("[assistant] summarizer failed, falling back:", err instanceof Error ? err.message : String(err));
    summaryText = FALLBACK_SUMMARY;
  }
  return [makeSummaryMessage(`摘要: ${summaryText}`), ...plan.keep];
}

// ---------------- Default summarizer (DeepSeek) ----------------

const SUMMARY_PROMPT = `把以下研究员与 AI 助手的对话历史压缩为 ≤200 字的中文摘要。
规则:
- 只保留事实 / 已决定的事项 / 已使用过的具体 surveyId 与 sessionId
- 不臆造数据
- 不复述工具结果原文, 提炼关键结论即可
- 不输出任何 XML 标签
对话:
`;

function flattenMessageForSummary(m: UIMessage): string {
  const text = (m.parts ?? [])
    .filter((p) => (p as { type: string }).type === "text")
    .map((p) => (p as { text?: string }).text ?? "")
    .join("");
  if (!text) return "";
  return `[${m.role}] ${text}`;
}

/** 默认摘要器: DeepSeek deepseek-chat, 温度 0.2, 10s 超时。失败抛错由 applyCompaction 兜住。 */
export const summarizeMessages: Summarizer = async (messages) => {
  const corpus = messages
    .map(flattenMessageForSummary)
    .filter((s) => s.length > 0)
    .join("\n");
  if (corpus.length === 0) return "";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const result = await generateText({
      model: CHAT_MODEL,
      temperature: 0.2,
      abortSignal: ctrl.signal,
      messages: [
        { role: "system", content: "你是一个专业的中文摘要器。" },
        { role: "user", content: `${SUMMARY_PROMPT}${corpus}` },
      ],
    });
    return result.text ?? "";
  } finally {
    clearTimeout(timer);
  }
};
