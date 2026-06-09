/**
 * Insights 功能的数据/契约层。
 *
 * 与 Morris AI(多轮对话 agent)不同,Insights 是"研究完成后"的一次性洞察生成:
 * 用户选定某个调研 + 输入一个聚焦问题 → 基于该调研的真实访谈数据,
 * 直连 DeepSeek 生成结构化洞察。
 *
 * 数据来源已迁到 Appwrite 真实查询(analysis-report 子 spec T8)。
 */

import {
  countCompletedSessions,
  getLatestAnalysisReport,
  getStudy,
  listStudies,
  parseSurveyReportBody,
  searchTranscriptSegments,
} from "./queries";

// 报告契约统一在 @merism/contracts/insight 维护;本文件只 re-export 以保持
// 现有 import 路径(lib/actions/insights.ts 等)不破裂。
export { notebookReportSchema, type NotebookReport } from "@merism/contracts";

/**
 * 供前端下拉选择的调研列表(只暴露需要的字段)。
 *
 * 现在读真实 Appwrite。Studies 当前由编辑器(Drizzle/Postgres)写入,
 * 在 survey-editor 子 spec 把编辑器迁到 Appwrite 之前,这里很可能返回空列表。
 * 这是已知的临时状态,不是 bug。
 */
export async function listStudyOptions(
  ownerUserId: string,
): Promise<Array<{ id: string; title: string; status: string; responses: number }>> {
  const surveys = await listStudies(ownerUserId);
  const enriched = await Promise.all(
    surveys.map(async (s) => ({
      id: s.$id,
      title: s.title,
      status: s.status,
      responses: await countCompletedSessions(ownerUserId, s.$id),
    })),
  );
  return enriched;
}

/** 校验 studyId 是否属于该研究员。 */
export async function isValidStudyId(ownerUserId: string, studyId: string): Promise<boolean> {
  const study = await getStudy(ownerUserId, studyId);
  return study !== null;
}

/**
 * 为给定调研构建洞察生成所需的上下文文本。
 *
 * 优先用最新 survey 级聚合报告作为上下文;若不存在则降级到 transcript 片段,
 * 让 LLM 至少能看到原始访谈内容做 grounding。
 */
export async function buildStudyContext(
  ownerUserId: string,
  studyId: string,
): Promise<string> {
  const study = await getStudy(ownerUserId, studyId);
  if (!study) return "(找不到该调研)";

  const report = await getLatestAnalysisReport(ownerUserId, {
    surveyId: studyId,
    scope: "survey",
  });
  const body = report ? parseSurveyReportBody(report) : null;

  const snippets = await searchTranscriptSegments(ownerUserId, {
    query: "",
    surveyId: studyId,
    limit: 30,
  });

  const sections: string[] = [`调研标题:${study.survey.title}`];

  if (body) {
    sections.push(`整体结论:${body.surveyTitle} (${body.completedRespondents} 份完成访谈)`);
    if (body.themes.length > 0) {
      sections.push(
        "高频主题分布:",
        body.themes
          .map((t) => `- ${t.label}:${t.mentions} 次,占比 ${t.pct}%`)
          .join("\n"),
      );
    }
    if (body.insights.length > 0) {
      sections.push(
        "已沉淀洞察:",
        body.insights
          .map((i) => `- ${i.title} (置信 ${Math.round(i.confidence * 100)}%):${i.text}`)
          .join("\n"),
      );
    }
  } else {
    sections.push("(尚无 survey 级聚合报告;以下基于原始 transcript 片段)");
  }

  if (snippets.length > 0) {
    sections.push(
      "受访者原话(节选):",
      snippets
        .map((s) => `- [${s.sessionId}#${s.segmentIndex}] ${s.speaker}:"${s.text}"`)
        .join("\n"),
    );
  } else {
    sections.push("(暂无可用的访谈原话)");
  }

  return sections.join("\n\n");
}
