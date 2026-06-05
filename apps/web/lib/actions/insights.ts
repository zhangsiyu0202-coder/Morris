"use server";

import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { insight, type InsightRow } from "@/lib/db/schema";
import {
  insightReportSchema,
  type InsightReport,
  buildStudyContext,
  isValidStudyId,
} from "@/lib/insights";
import { STUDIES } from "@/lib/agent-data";

// 与 Morris AI 一致:直连 DeepSeek 官方,不引入其它供应商。
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

const ANALYSIS_INSTRUCTIONS = `你是 Morris 的研究洞察引擎。用户已完成一项调研,针对该调研提出一个聚焦问题。
你的任务是结合调研的会话内容,对这个问题做一次「深入论证型」分析报告(区别于整体数据汇总)。

报告组织方式为「结论在先,证据支撑」:
- headline 给出最精炼的核心结论;directAnswer 用 2-3 句明确表态。
- themes 从多个角度逐层论证,每个角度都要有受访者原话支撑(quotes 引用真实原话)。
- divergences 必须呈现受访者之间真实存在的观点分歧或对立立场。
- actions 给出分优先级(P0/P1/P2)、可执行且与分析强关联的建议。

硬性要求:
- 只依据提供的「调研上下文」作答,绝不编造数据或原话。数据不足时在 confidenceReason 中说明并下调 confidence。
- 全程使用中文,语言专业、有判断力。`;

export type InsightListItem = Pick<
  InsightRow,
  "id" | "studyId" | "studyTitle" | "question" | "headline" | "summary" | "confidence" | "sampleSize" | "createdAt"
>;

/** 生成一份深度洞察报告并落库,返回新记录 id。生成时一次算好,详情页直接读取。 */
export async function createInsight(input: {
  studyId: string;
  question: string;
}): Promise<{ id: string } | { error: string }> {
  const studyId = typeof input.studyId === "string" ? input.studyId.trim() : "";
  const question = typeof input.question === "string" ? input.question.trim() : "";

  if (!studyId) return { error: "缺少调研。" };
  if (!isValidStudyId(studyId)) return { error: "指定的调研不存在。" };
  if (question.length < 2) return { error: "请输入一个有效的问题(至少 2 个字符)。" };

  const study = STUDIES.find((s) => s.id === studyId)!;

  try {
    const context = buildStudyContext(studyId);

    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 2,
      experimental_output: Output.object({ schema: insightReportSchema }),
      system: ANALYSIS_INSTRUCTIONS,
      prompt: `调研上下文:\n${context}\n\n用户的问题:${question}\n\n请基于上述上下文生成深入论证型分析报告。`,
    });

    const report = experimental_output as InsightReport;

    const [row] = await db
      .insert(insight)
      .values({
        studyId,
        studyTitle: study.title,
        question,
        headline: report.headline,
        summary: report.directAnswer,
        confidence: report.confidence,
        sampleSize: study.responses,
        report,
      })
      .returning({ id: insight.id });

    revalidatePath("/insights");
    return { id: row.id };
  } catch (err) {
    console.error("[v0] createInsight failed:", err);
    return { error: "洞察生成失败,请稍后重试。" };
  }
}

/** 列表:读取全部洞察(卡片字段),按时间倒序。 */
export async function listInsights(): Promise<InsightListItem[]> {
  return db
    .select({
      id: insight.id,
      studyId: insight.studyId,
      studyTitle: insight.studyTitle,
      question: insight.question,
      headline: insight.headline,
      summary: insight.summary,
      confidence: insight.confidence,
      sampleSize: insight.sampleSize,
      createdAt: insight.createdAt,
    })
    .from(insight)
    .orderBy(desc(insight.createdAt));
}

/** 详情:按 id 读取完整记录(含 report)。 */
export async function getInsightById(id: string): Promise<InsightRow | null> {
  const rows = await db.select().from(insight).where(eq(insight.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 删除一条洞察。 */
export async function deleteInsight(id: string): Promise<void> {
  await db.delete(insight).where(eq(insight.id, id));
  revalidatePath("/insights");
}
