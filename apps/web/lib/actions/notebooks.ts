"use server";

import { generateText, Output } from "ai";
import { withLLMCall, createLogger } from "@merism/observability";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { Client, Databases } from "node-appwrite";
import { revalidatePath } from "next/cache";
import { type Notebook, notebookReportSchema } from "@merism/contracts";
import type { NotebookReport } from "@merism/contracts";
import {
  buildStudyContext,
  isValidStudyId,
} from "@/lib/notebooks";
import {
  countCompletedSessions,
  getCurrentUserId,
  getNotebookById as readNotebookById,
  getStudy,
  listNotebooks as readNotebooks,
} from "@/lib/queries";
import { saveNotebookFromMarkdown } from "@/lib/server/notebooks";

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

/** 卡片视图所需的轻量字段集合。 */
export type NotebookListItem = {
  id: string;
  shortId: string;
  studyId: string;
  studyTitle: string;
  question: string;
  headline: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  sampleSize: number;
  createdAt: string;
};

function toListItem(i: Notebook): NotebookListItem {
  return {
    id: i.$id,
    shortId: i.shortId,
    studyId: i.studyId,
    studyTitle: i.studyTitle,
    question: i.question,
    headline: i.headline,
    summary: i.summary,
    confidence: i.confidence,
    sampleSize: i.sampleSize,
    createdAt: i.createdAt,
  };
}

function getServerKeyClient(): { client: Client; db: Databases } {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error("appwrite_not_configured");
  }
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return { client, db: new Databases(client) };
}

/**
 * Wave F (T48): NotebookReport (DeepSeek experimental_output 中间格式)
 * 渲染为 Markdown, 喂给 saveNotebookFromMarkdown 进行 ProseMirror 落库。
 *
 * 5 段 HeadingTemplate (D3): # Question / ## 核心结论 / ## 主题分析 /
 * ## 立场分歧 / ## 行动建议. 让 NotebookViewer 卡片视图能正确抽段渲染。
 */
function notebookReportToMarkdown(question: string, report: NotebookReport): string {
  const lines: string[] = [];
  lines.push(`# ${question}`);
  lines.push("");
  lines.push(report.directAnswer);
  lines.push("");
  lines.push(`## 核心结论`);
  lines.push("");
  lines.push(`${report.headline} (${confidenceLabel(report.confidence)}: ${report.confidenceReason})`);
  lines.push("");
  lines.push(`## 主题分析`);
  for (const t of report.themes) {
    lines.push("");
    lines.push(`### ${t.title}`);
    lines.push("");
    lines.push(t.analysis);
    if (t.quotes.length > 0) {
      lines.push("");
      for (const q of t.quotes) {
        lines.push(`> "${q}"`);
      }
    }
  }
  lines.push("");
  lines.push(`## 立场分歧`);
  if (report.divergences.length === 0) {
    lines.push("");
    lines.push("(无明显分歧)");
  } else {
    for (const d of report.divergences) {
      lines.push("");
      lines.push(`- **${d.group}**: ${d.stance}`);
    }
  }
  lines.push("");
  lines.push(`## 行动建议`);
  for (const a of report.actions) {
    lines.push("");
    lines.push(`- **[${a.priority}]** ${a.action}`);
    lines.push(`  - ${a.rationale}`);
  }
  return lines.join("\n");
}

function confidenceLabel(c: "high" | "medium" | "low"): string {
  return c === "high" ? "高置信度" : c === "medium" ? "中等置信度" : "低置信度";
}

/** 生成一份深度洞察报告并落 Appwrite,返回新记录 id + shortId。 */
export async function createNotebook(input: {
  studyId: string;
  question: string;
}): Promise<{ id: string; shortId: string } | { error: string }> {
  const studyId = typeof input.studyId === "string" ? input.studyId.trim() : "";
  const question = typeof input.question === "string" ? input.question.trim() : "";

  if (!studyId) return { error: "缺少调研。" };
  if (question.length < 2) return { error: "请输入一个有效的问题(至少 2 个字符)。" };

  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return { error: "请先登录。" };

  const valid = await isValidStudyId(ownerUserId, studyId);
  if (!valid) return { error: "指定的调研不存在或不属于当前账户。" };

  const study = await getStudy(studyId);
  if (!study) return { error: "找不到该调研。" };

  try {
    const context = await buildStudyContext(ownerUserId, studyId);
    const log = createLogger("action.notebooks.generateReport");

    // DeepSeek 仍生成结构化 NotebookReport 中间格式 (作为 experimental_output schema)
    const { experimental_output } = await withLLMCall(
      {
        scope: "action.notebooks.generateReport",
        traceId: log.traceId,
        defaultModel: "deepseek-chat",
      },
      () =>
        generateText({
          model: deepseek("deepseek-chat"),
          maxRetries: 2,
          experimental_output: Output.object({ schema: notebookReportSchema }),
          system: ANALYSIS_INSTRUCTIONS,
          prompt: `调研上下文:\n${context}\n\n用户的问题:${question}\n\n请基于上述上下文生成深入论证型分析报告。`,
        }),
    );

    const report = experimental_output as NotebookReport;
    // 把结构化 NotebookReport 渲染为 5 段 HeadingTemplate Markdown,
    // 然后用 saveNotebookFromMarkdown 落 ProseMirror content + embedding。
    const markdown = notebookReportToMarkdown(question, report);
    const result = await saveNotebookFromMarkdown({
      ownerUserId,
      studyId,
      studyTitle: study.survey.title,
      question,
      markdown,
    });
    // sampleSize 单独写入是 cosmetic — saveNotebookFromMarkdown 内部 default 0;
    // 这里为了与现有 UI 一致, 不再额外更新 row (Wave F: D10 read-only).
    void countCompletedSessions; // unused after Wave F refactor
    revalidatePath("/notebooks");
    return { id: result.$id, shortId: result.shortId };
  } catch (err) {
    console.error("[notebooks] createNotebook failed:", err);
    return { error: "洞察生成失败,请稍后重试。" };
  }
}

/** 列表:读取当前研究员的所有 notebook(卡片字段),按时间倒序。 */
export async function listNotebooks(): Promise<NotebookListItem[]> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return [];
  const notebooks = await readNotebooks();
  return notebooks.map(toListItem);
}

/** 详情:按 id 读取完整记录(含 content)。仅 owner 可读。 */
export async function getNotebookById(id: string): Promise<Notebook | null> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return null;
  return readNotebookById(id);
}

/** 删除一条 notebook。仅 owner 可删。 */
export async function deleteNotebook(id: string): Promise<{ ok: boolean }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return { ok: false };
  // Verify ownership via a read first; the server key bypasses Permissions
  // so we cannot rely on Appwrite to enforce it here.
  const existing = await readNotebookById(id);
  if (!existing) return { ok: false };
  const { db } = getServerKeyClient();
  const DATABASE_ID = process.env.APPWRITE_DATABASE_ID ?? "merism";
  await db.deleteDocument(DATABASE_ID, "notebooks", id);
  revalidatePath("/notebooks");
  return { ok: true };
}
