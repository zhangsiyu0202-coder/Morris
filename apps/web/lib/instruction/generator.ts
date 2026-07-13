/**
 * Instruction baseline generator (ADR-0015 Wave 2).
 *
 * Single shared LLM entry point for turning a study's questions into a
 * well-formatted markdown "AI moderator operating manual". This is the
 * ONLY place a baseline instruction is generated in the codebase — the
 * server action (`apps/web/lib/actions/instruction.ts`) wraps this for
 * the guide-editor "生成 baseline" button, and any future Morris tool
 * for conversational regeneration (e.g. `regenerateInstructionBaseline`)
 * must go through here too. Do not fork the prompt.
 *
 * Prompt design borrows the Claude Code `/init` pattern:
 *   - Fixed section template + explicit ordering
 *   - Length + style constraints
 *   - Few-shot example (one hand-written reference)
 *   - Low temperature for stable output
 *
 * Model: DeepSeek (Morris side per steering; the interview-worker Qwen
 * stays for the ASR/TTS/interview chain). Observability goes through
 * `withLLMCall` scope `action.instruction.generate` per
 * `errors-and-observability.md::LLM call observability`.
 */

"use server";

import { generateText } from "ai";
import { withLLMCall, createLogger } from "@merism/observability";
import { createDeepSeek } from "@ai-sdk/deepseek";

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

const log = createLogger("action.instruction.generate");

// ---------------------------------------------------------------------------
// Prompt template — Claude Code `/init` style
// ---------------------------------------------------------------------------

const BASELINE_SYSTEM_PROMPT = `你是 Merism 的访谈说明写作专家。你为一次定性用户访谈撰写"AI 主持人运行说明"(instruction)。
这份说明会作为 AI 访谈主持人的完整 operating manual 一次性加载,主持人根据它决定语气、开场、追问方向、结束方式,以及事后的分析也依据它理解研究意图。

# 你必须遵守的结构

输出一份 markdown 文档,严格包含以下 5 个 section,按此顺序,不多不少:

## 研究意图
(1-3 句,说明这次访谈想学到什么,以及最想验证的假设/最想理解的现象。不要重复标题。)

## 访谈对象
(1-2 句,说明访谈的是谁、他们的关键背景假设。若研究员未提供受众信息,写"未指定"。)

## 主持行为要点
(3-6 条 bullets,每条一行。写清楚:主持语气、追问原则、边界。避免陈词滥调。)

## 开场
(2-3 句,说明如何自我介绍 + 建立 rapport + 引入第一问。不需要给逐字稿。)

## 结束
(1-2 句,说明如何 wrap up 与感谢。)

# 你必须遵守的样式

- 全程简体中文,口语化、清爽,不用官话套话
- 不用 emoji,不用 code block
- Bullets 保持一致粒度 (每条 8-25 字为宜)
- 不要在正文里说"根据用户提供的问题列表"这种自我指涉
- 不要抄回原始问题条目;instruction 是**关于**问题的意图,不是问题本身

# 参考风格

以下是一个 well-formatted instruction 的样例(不要抄内容,只学结构与文风):

<example>
## 研究意图
了解 SaaS 首月流失用户的核心决策路径 — 他们在何时开始动摇,以及是什么触发了退订。重点验证"上手门槛"与"价格感知"哪一个是更强的信号。

## 访谈对象
过去 90 天内注册后 30 天内退订的付费用户。假设他们在决策时并未与销售或客服有过深度接触。

## 主持行为要点
- 语气温和,允许沉默,不追问过快
- 遇到抽象回答("感觉不好用"),追问具体场景与时刻
- 不引导受访者与竞品对比 — 让他们自然提起
- 用户表达情绪时先接住,再回问事实
- 全程不推销、不解释产品定位

## 开场
先自我介绍是产品团队的研究员,简单说明这次谈话不涉及推销或客服流程,时长 20 分钟左右,征得同意后开始。第一问从他们最近使用软件的整体印象聊起。

## 结束
表达感谢,告知后续如何补偿(如有),询问对方是否有想问的、想反馈的。
</example>`;

/** Input to the baseline generator. */
export interface GenerateBaselineInput {
  /** Survey title as it appears in the editor. Trimmed by caller. */
  surveyTitle: string;
  /**
   * Flat list of the researcher's authored questions, in interview order.
   * The generator uses these to understand what the study is trying to
   * learn — it does NOT reproduce them verbatim. Section grouping is
   * flattened away because sections have no runtime meaning in the flow
   * engine (they are editor UX only, per ADR-0014).
   */
  questions: ReadonlyArray<{ text: string; type: string }>;
  /**
   * Optional legacy hints — the four soon-to-be-sunset fields from
   * pre-ADR-0015 surveys. When provided, the prompt includes them as
   * "researcher-authored background context" so the generator doesn't
   * have to guess the research goal / audience from questions alone.
   * Post-Wave 5 (legacy sunset) this shape simplifies to just title +
   * questions.
   */
  legacy?: {
    researchGoal?: string;
    targetAudience?: string;
    introScript?: string;
    moderatorInstruction?: string;
  };
}

function summarizeQuestions(questions: GenerateBaselineInput["questions"]): string {
  if (questions.length === 0) return "(暂无问题)";
  return questions
    .map((q, i) => {
      const type = q.type ? ` [${q.type}]` : "";
      return `${i + 1}. ${q.text}${type}`;
    })
    .join("\n");
}

function summarizeLegacy(legacy: GenerateBaselineInput["legacy"]): string {
  if (!legacy) return "";
  const lines: string[] = [];
  if (legacy.researchGoal?.trim()) lines.push(`原研究目标:${legacy.researchGoal.trim()}`);
  if (legacy.targetAudience?.trim()) lines.push(`原目标受众:${legacy.targetAudience.trim()}`);
  if (legacy.introScript?.trim()) lines.push(`原开场:${legacy.introScript.trim()}`);
  if (legacy.moderatorInstruction?.trim()) {
    lines.push(`原主持指令:${legacy.moderatorInstruction.trim()}`);
  }
  if (lines.length === 0) return "";
  return [
    "",
    "# 研究员已有的背景信息(可作为写作参考,不要照搬)",
    ...lines,
  ].join("\n");
}

/**
 * Generate a markdown baseline instruction from a study's questions.
 *
 * Throws on LLM failure — the server action / tool wrapper decides how to
 * surface the error to the user. Not retried here (retry is the caller's
 * policy).
 */
export async function generateInstructionBaseline(
  input: GenerateBaselineInput,
): Promise<string> {
  const title = input.surveyTitle.trim() || "(未填写)";
  const legacyBlock = summarizeLegacy(input.legacy);

  const userPrompt = [
    `# 待撰写 instruction 的调研`,
    `标题:${title}`,
    ``,
    `# 该调研的问题清单(按访谈顺序)`,
    summarizeQuestions(input.questions),
    legacyBlock,
    ``,
    `请基于以上信息撰写这份 instruction。`,
  ].join("\n");

  const { text } = await withLLMCall(
    {
      scope: "action.instruction.generate",
      traceId: log.traceId,
      defaultModel: "deepseek-chat",
    },
    () =>
      generateText({
        model: deepseek("deepseek-chat"),
        maxRetries: 2,
        // Low temperature stabilizes the section structure. Higher would
        // start reordering or renaming sections which breaks downstream
        // LLM consumers (analyzeSession etc.) that read the markdown.
        temperature: 0.4,
        system: BASELINE_SYSTEM_PROMPT,
        prompt: userPrompt,
        maxOutputTokens: 1200,
      }),
  );

  const cleaned = text.trim();
  if (!cleaned) {
    throw new Error("LLM returned empty baseline instruction");
  }
  return cleaned;
}
