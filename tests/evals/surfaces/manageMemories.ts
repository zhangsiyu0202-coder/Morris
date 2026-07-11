import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  ManageMemoriesActionSchema,
  type ManageMemoriesAction,
} from "@merism/contracts";
import { z } from "zod";

import type { SurfaceAdapter } from "./_types";

export interface ManageMemoriesSurfaceInput {
  readonly userMessage: string;
  readonly existingMemories?: ReadonlyArray<{
    readonly memoryId: string;
    readonly content: string;
    readonly metadata?: Record<string, unknown>;
  }>;
}

export type ManageMemoriesSurfaceOutput =
  | { readonly kind: "action"; readonly action: ManageMemoriesAction }
  | { readonly kind: "refusal"; readonly reason: string };

const SYSTEM_PROMPT = `你是 Merism 研究员助手 Morris 的 manageMemories 子模块。
你的任务不是回答用户问题,而是判断在长期记忆层应执行什么动作。

输出规则:
1. 只输出结构化 JSON,不要 markdown。
2. 动作只能是 create/query/update/delete/list 之一。
3. 用户明确说“记住这个”/“保存这个偏好” → create。
4. 用户问“我之前提过什么”/“帮我回忆” → query。
5. 用户明确修改既有偏好 → update (需要 memoryId)。
6. 用户明确删除既有记忆 → delete (需要 memoryId)。
7. 用户只是想看全部记忆 → list。
8. 若请求超出 Morris 长期记忆范围,返回 refusal。`;

const FlatOutputSchema = z.object({
  kind: z.enum(["action", "refusal"]),
  action: z.enum(["create", "query", "update", "delete", "list"]).optional(),
  content: z.string().optional(),
  queryText: z.string().optional(),
  memoryId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  metadataFilter: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().positive().optional(),
  reason: z.string().optional(),
});

export const manageMemoriesSurface: SurfaceAdapter<
  ManageMemoriesSurfaceInput,
  ManageMemoriesSurfaceOutput
> = {
  name: "morris.tool.manageMemories",

  async invoke(input) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY not set — eval surface morris.tool.manageMemories requires a real provider key',
      );
    }

    const deepseek = createDeepSeek({ apiKey });
    const memoriesBlock = (input.existingMemories ?? [])
      .map((m) => `- ${m.memoryId}: ${m.content}`)
      .join("\n");
    const prompt = [
      `用户请求: ${input.userMessage}`,
      memoriesBlock ? "已有 memories:\n" + memoriesBlock : "已有 memories: (none)",
      "若选择 update/delete 且输入里没有可识别的 memoryId,则返回 query 或 refusal,不要编造 id。",
    ].join("\n\n");

    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 1,
      experimental_output: Output.object({ schema: FlatOutputSchema }),
      system: SYSTEM_PROMPT,
      prompt,
    });

    if (!experimental_output || experimental_output.kind === "refusal") {
      return {
        kind: "refusal",
        reason:
          typeof experimental_output?.reason === "string"
            ? experimental_output.reason
            : "model refused to choose a memory action",
      };
    }

    const parsed = ManageMemoriesActionSchema.safeParse(experimental_output);
    if (!parsed.success) {
      return {
        kind: "refusal",
        reason: parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }

    return { kind: "action", action: parsed.data };
  },
};
