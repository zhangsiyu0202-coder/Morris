"use server";

import { db } from "@/lib/db";
import { study, type StudyRow } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  type Guide,
  countQuestions,
  localId,
  normalizeGuide,
  type StudyStatus,
} from "@/lib/guide";

export type StudyCard = {
  id: string;
  title: string;
  status: StudyStatus;
  researchGoal: string;
  responses: number;
  completionRate: number;
  sectionCount: number;
  questionCount: number;
  updatedAt: string;
};

function toCard(row: StudyRow): StudyCard {
  const guide = normalizeGuide(row.guide);
  return {
    id: row.id,
    title: row.title,
    status: row.status as StudyStatus,
    researchGoal: row.researchGoal,
    responses: row.responses,
    completionRate: row.completionRate,
    sectionCount: guide.sections.length,
    questionCount: countQuestions(guide),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 首页:列出所有 study(卡片视图用)。 */
export async function listStudies(): Promise<StudyCard[]> {
  const rows = await db.select().from(study).orderBy(desc(study.updatedAt));
  return rows.map(toCard);
}

export type StudyDetail = {
  id: string;
  title: string;
  status: StudyStatus;
  researchGoal: string;
  targetAudience: string;
  introScript: string;
  guide: Guide;
  responses: number;
  completionRate: number;
};

/** 编辑器:读取单个 study 的完整信息(含 guide)。 */
export async function getStudy(id: string): Promise<StudyDetail | null> {
  const rows = await db.select().from(study).where(eq(study.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status as StudyStatus,
    researchGoal: row.researchGoal,
    targetAudience: row.targetAudience,
    introScript: row.introScript,
    guide: normalizeGuide(row.guide),
    responses: row.responses,
    completionRate: row.completionRate,
  };
}

/** 新建一个空白 study,返回其 id。 */
export async function createStudy(title: string): Promise<string> {
  const id = localId("st");
  await db.insert(study).values({
    id,
    title: title.trim() || "未命名调研",
    status: "draft",
    guide: { sections: [] },
    introScript: "",
  });
  revalidatePath("/home");
  return id;
}

/** 保存 study 元信息(标题/目标/受众/开场白)。 */
export async function updateStudyMeta(
  id: string,
  meta: {
    title: string;
    researchGoal: string;
    targetAudience: string;
    introScript: string;
  },
): Promise<void> {
  await db
    .update(study)
    .set({
      title: meta.title.trim() || "未命名调研",
      researchGoal: meta.researchGoal,
      targetAudience: meta.targetAudience,
      introScript: meta.introScript,
      updatedAt: new Date(),
    })
    .where(eq(study.id, id));
  revalidatePath("/home");
  revalidatePath(`/studies/${id}`);
}

/** 保存 guide(提纲)。 */
export async function saveGuide(id: string, guide: Guide): Promise<void> {
  await db
    .update(study)
    .set({ guide, updatedAt: new Date() })
    .where(eq(study.id, id));
  revalidatePath("/home");
  revalidatePath(`/studies/${id}`);
}

/** 切换 study 状态。 */
export async function updateStudyStatus(id: string, status: StudyStatus): Promise<void> {
  await db
    .update(study)
    .set({ status, updatedAt: new Date() })
    .where(eq(study.id, id));
  revalidatePath("/home");
  revalidatePath(`/studies/${id}`);
}

/** 删除 study。 */
export async function deleteStudy(id: string): Promise<void> {
  await db.delete(study).where(eq(study.id, id));
  revalidatePath("/home");
}
