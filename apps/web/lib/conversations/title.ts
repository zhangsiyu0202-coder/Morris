/**
 * Morris Conversation title 自动生成
 * (per `.kiro/specs/morris-conversation-persistence/design.md` §8).
 *
 * `actions.ts::saveMessages` 在第 1 条消息写库后 fire-and-forget 调本函数 —
 * 不 await, 失败仅 log.warn 不阻塞 UX. design.md §11.3 是 best-effort:
 *  - 失败留 title="", UI fallback "新对话"
 *  - 不重试
 *  - 输出截到 MAX_TITLE_LENGTH 字符
 *
 * LLM 调用走 withLLMCall(scope="morris.title.generate") 接 LLMObservability
 * (per errors-and-observability.md::LLM 调用观测), 不绕过统一 sink.
 */

"use server";

import { generateText } from "ai";
import { withLLMCall, createLogger } from "@merism/observability";
import { MAX_TITLE_LENGTH } from "@merism/contracts";
import { getCurrentUserId } from "@/lib/queries/auth";
import { CHAT_MODEL } from "@/lib/assistant/model";
import { saveTitle, loadConversationDoc } from "./server";

const log = createLogger("action.conversations.title");

/**
 * Title generator — 给定 conversationId + 第 1 条 user UIMessage, 用
 * deepseek-chat 生成 5-7 字简体中文摘要回写到 doc.title.
 *
 * 调用方约定: void 调用 + .catch 不抛 (saveMessages 那侧已经裹 catch).
 * 这里仍然把 Promise 暴露为可 await, 方便测试直接 await 验证 saveTitle 被调.
 */
/**
 * One LLM round-trip + persist. Throws on any LLM / save failure so the outer
 * `generateConversationTitle` can retry once before giving up.
 */
async function generateOnce(conversationId: string, userText: string): Promise<void> {
  const { text } = await withLLMCall(
    {
      scope: "morris.title.generate",
      traceId: log.traceId,
      defaultModel: "deepseek-chat",
    },
    () =>
      generateText({
        model: CHAT_MODEL,
        prompt:
          `用 5-7 字简体中文概括这个对话主题, 例如: "调研报告分析" / "用户访谈检索". ` +
          `仅返回标题, 不加引号或解释.\n\n` +
          `用户消息:\n${userText.slice(0, 500)}`,
        maxOutputTokens: 16,
      }),
  );

  const title = text.trim().slice(0, MAX_TITLE_LENGTH);
  if (title) {
    await saveTitle(conversationId, title);
    log.info("conversation.title.generated", { conversationId, title });
  }
}

const TITLE_RETRY_DELAY_MS = 5_000;

export async function generateConversationTitle(
  conversationId: string,
  firstUserMessage: unknown,
): Promise<void> {
  const userText = extractText(firstUserMessage);
  if (!userText.trim()) {
    // design.md §8: 空 user message 跳过 — title 留 "" UI fallback "新对话".
    return;
  }

  // SECURITY: this is a server action and reachable directly via the Next.js
  // RPC layer. Even though the canonical caller (saveMessages) already checked
  // ownership, an attacker could fabricate a conversationId pointing at a
  // victim's row — without this guard we'd burn an LLM call rewriting that
  // victim's title. Read the doc + compare ownerUserId before doing anything.
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return;
  const doc = await loadConversationDoc(conversationId);
  if (!doc || doc.ownerUserId !== ownerUserId) {
    log.warn("conversation.title.unauthorized", { conversationId, ownerUserId });
    return;
  }

  try {
    await generateOnce(conversationId, userText);
    return;
  } catch (err) {
    // First-attempt failure (DeepSeek 5xx, network, save 409). Wait briefly
    // and retry once — caller is fire-and-forget so the delay does not block
    // the saveMessages path. After the retry fails too we swallow + log.warn:
    // title stays "" and UI falls back to "新对话".
    log.warn("conversation.title.attempt1.failed", {
      conversationId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  await sleep(TITLE_RETRY_DELAY_MS);

  try {
    await generateOnce(conversationId, userText);
  } catch (err) {
    log.warn("conversation.title.attempt2.failed.giving.up", {
      conversationId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Test seam: replace setTimeout via vi.useFakeTimers in unit tests. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从 UIMessage 抽 plain text. UIMessage 来自 Vercel AI SDK 6:
 * `{ role, parts: [{ type: "text", text }, ...] }`. 我们只关心 type=text,
 * tool / reasoning / file 的非文本 payload 不进 title prompt.
 */
function extractText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { parts?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(m.parts)) return "";
  return m.parts
    .filter((p) => p?.type === "text")
    .map((p) => p?.text ?? "")
    .join("");
}
