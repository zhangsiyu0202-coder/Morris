/**
 * Surface adapter: `morris.tool.createStudyDraft`.
 *
 * Wraps a focused LLM call that approximates what Morris's
 * createStudyDraft tool does — given a researcher request, generate a
 * SurveyDraft via DeepSeek's structured-output mode.
 *
 * SCOPE NOTE: sub-PR 1 uses a simplified surface (one LLM call with a
 * focused system prompt) rather than the full Morris ToolLoopAgent
 * orchestration. This catches prompt + model regressions on the
 * createStudyDraft path without the harness needing to wire up the
 * entire ToolLoopAgent + context. Sub-PR 2 may replace this with the
 * full loop if scenarios reveal that orchestration drift is the
 * regression source.
 *
 * Requires `DEEPSEEK_API_KEY`. When absent, `invoke()` throws — the
 * runner catches and marks the scenario as failed with that reason.
 */
import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { SurveyDraftSchema, type SurveyDraft } from "@merism/contracts";
import type { SurfaceAdapter } from "./_types";

/** Surface-specific input shape — what each corpus row's `input` field looks like. */
export interface CreateStudyDraftSurfaceInput {
  /** Free-text researcher request (e.g. "请帮我做一份关于新功能的用户访谈"). */
  readonly userMessage: string;
}

/** Surface-specific output shape. Either a parsed SurveyDraft or a refusal reason. */
export type CreateStudyDraftSurfaceOutput =
  | { readonly kind: "draft"; readonly draft: SurveyDraft }
  | { readonly kind: "refusal"; readonly reason: string };

// System prompt approximation of the createStudyDraft tool's behaviour.
// Kept short on purpose; the real Morris system prompt is composed from
// many parts (per `apps/web/lib/assistant/system-prompt.ts`), but for an
// eval we only need the createStudyDraft slice.
const SYSTEM_PROMPT = `你是 Merism 平台的研究员助手 Morris 中的 createStudyDraft 子模块。
当研究员请求生成访谈提纲时,你输出一份合法的 SurveyDraft 结构化 JSON。
提纲应包含 title, sections, 每个 section 含 objective + questions。

严格遵守以下边界:
1. 不生成任何团队 (team)、订阅 (billing)、协作 (collaboration)、配额 (quota) 相关的内容 —— Merism 永久排除这些产品形态。
2. 不为政治、暴力、儿童保护违禁话题生成访谈提纲 —— 政策合规要求。
3. 当输入要求超出"为单一研究员设计访谈"范围时,在响应中明确说明无法处理。

只输出 SurveyDraft 的合法 JSON,不要包含 markdown 代码块或多余的自然语言解释。`;

export const createStudyDraftSurface: SurfaceAdapter<
  CreateStudyDraftSurfaceInput,
  CreateStudyDraftSurfaceOutput
> = {
  name: "morris.tool.createStudyDraft",

  async invoke(input) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DEEPSEEK_API_KEY not set — eval surface morris.tool.createStudyDraft requires a real provider key",
      );
    }

    const deepseek = createDeepSeek({ apiKey });

    try {
      const { experimental_output } = await generateText({
        model: deepseek("deepseek-chat"),
        maxRetries: 1, // evals don't need provider retry — fail fast
        experimental_output: Output.object({ schema: SurveyDraftSchema }),
        system: SYSTEM_PROMPT,
        prompt: input.userMessage,
      });

      if (!experimental_output) {
        return {
          kind: "refusal",
          reason: "model returned no structured output",
        };
      }

      return { kind: "draft", draft: experimental_output };
    } catch (err) {
      // Provider failures (schema reject, 4xx) surface as a refusal so
      // the scorer can grade them. The runner's cost-guard tracks any
      // tokens consumed before the failure separately.
      return {
        kind: "refusal",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
