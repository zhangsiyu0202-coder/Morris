import { tool } from "ai";
import { z } from "zod";

import {
  toToolError,
  toolResult,
  type ToolErrorArtifact,
  type ToolResultEnvelope,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";
import type { ToolMetadata } from "../tool-metadata";

interface DraftArtifact {
  title: string;
  goal: string;
  audience: string;
  questions: Array<{ order: number; prompt: string }>;
  note: string;
}

// Mock 题库:在 survey-editor 子 spec 接通真实创建流程前作为占位。
const STUDY_QUESTION_BANK = [
  "当你需要解决这个问题时,通常会怎么做?",
  "请回想最近一次相关的经历,具体发生了什么?",
  "在这个过程中,最让你困扰的是什么?",
  "你尝试过哪些替代方案?效果如何?",
  "如果有一个理想的解决方案,它应该是什么样的?",
  "你愿意为此付出多少时间或成本?",
  "还有什么我们没问到、但你觉得重要的吗?",
  "你是如何评估一个方案是否值得继续使用的?",
  "在做决定时,谁或什么会影响你?",
  "回到最开始,你希望当时有人告诉你什么?",
];

/**
 * `createStudyDraft` 工具:[临时] 根据研究目标产出一份草稿提案(只对话展示)。
 *
 * 不依赖 ownerUserId / 不读 Appwrite,所以未登录也能用。
 * 不声明 contextPromptTemplate (与具体页面无关)。
 */
export function buildCreateStudyDraftTool(_ctx: AssistantToolContext) {
  const metadata: ToolMetadata = {
    title: "创建调研草稿",
    description:
      "[临时] 根据研究目标创建一份调研草稿提案 (标题 / 研究目标 / 建议问题列表)。" +
      "当用户说'帮我设计一个调研'、'我想了解 X 怎么做'时调用。" +
      "audience 可为 null 表示未指定; questionCount 在闭区间 [3..10] 之间; 返回 questions 按 order 升序。" +
      "当前为 mock 输出 (只在对话中展示, 不写入 Appwrite); 真实创建流程待 survey-editor sub-spec 落地后, type 升级为 write 并接通持久化。",
    annotations: { readOnly: true, destructive: false, idempotent: false },
    requiredScopes: [],
    type: "draft",
    enabled: true,
  };
  return {
    contextPromptTemplate: undefined as string | undefined,
    metadata,
    spec: tool({
      description:
        "[临时] 根据研究目标创建一份调研草稿提案 (标题 / 研究目标 / 建议问题列表)。" +
        "当用户说'帮我设计一个调研'、'我想了解 X 怎么做'时调用。" +
        "audience 可为 null 表示未指定; questionCount 在闭区间 [3..10] 之间; 返回 questions 按 order 升序。" +
        "当前为 mock 输出 (只在对话中展示, 不写入 Appwrite); 真实创建流程待 survey-editor sub-spec 落地后, type 升级为 write 并接通持久化。",
      inputSchema: z.object({
        goal: z.string().min(1).describe("研究目标的自然语言描述"),
        audience: z.string().nullable().describe("目标受访人群,可为空"),
        questionCount: z.number().int().min(3).max(10).describe("建议的问题数量(3-10)"),
      }),
      execute: async ({
        goal,
        audience,
        questionCount,
      }): Promise<ToolResultEnvelope<DraftArtifact | ToolErrorArtifact>> => {
        try {
          const count = Math.min(Math.max(Math.round(questionCount), 3), 10);
          const questions = STUDY_QUESTION_BANK.slice(0, count).map((q, i) => ({
            order: i + 1,
            prompt: q,
          }));
          const artifact: DraftArtifact = {
            title: `${goal.slice(0, 20)} — 用户调研`,
            goal,
            audience: audience?.trim() ? audience : "未指定",
            questions,
            note:
              "当前为草稿提案(mock),未在 Appwrite 中创建真实 Survey 行。survey-editor 子 spec 实施后将接通真实创建流程。",
          };
          return toolResult(
            `已生成「${artifact.title}」草稿,包含 ${artifact.questions.length} 个建议问题。`,
            artifact,
          );
        } catch (err) {
          return toToolError("创建调研草稿", err);
        }
      },
    }),
  };
}
