"use server";

import { ID } from "node-appwrite";
import { SurveyDraftSchema, type SurveyDraft } from "@merism/contracts";
import { getServerClient, DATABASE_ID, Query } from "@/lib/queries/client";
import { getOwnerUserId } from "@/lib/owner";

/**
 * 编辑器写路径(Appwrite)。把编辑态 `SurveyDraft` 规范化落到
 * `surveys` + `survey_sections` + `question_blocks` 三表。
 *
 * 设计见 survey-editor design §5：边界用 `SurveyDraftSchema` 校验;每个操作经
 * `getOwnerUserId()` + 所有权闸门;保存采用「全量替换」(删旧建新),天然满足
 * draft↔persisted 往返无损(P-DATA-01)。JSON 字段以字符串存储(schema 为
 * string 属性),写时 `JSON.stringify`。
 */

const SURVEYS = "surveys";
const SECTIONS = "survey_sections";
const QUESTIONS = "question_blocks";
const DEFAULT_PROJECT = "default";

type EditorStatus = "draft" | "live" | "closed";

function toAppwriteStatus(s: EditorStatus): "draft" | "published" | "archived" {
  return s === "live" ? "published" : s === "closed" ? "archived" : "draft";
}

function db() {
  return getServerClient().databases;
}

/** 读取并校验 survey 归属当前 owner;不属于则抛错(P-SEC-04)。 */
async function assertOwned(surveyId: string): Promise<{ ownerUserId: string; version: number }> {
  const owner = getOwnerUserId();
  const doc = await db().getDocument(DATABASE_ID, SURVEYS, surveyId);
  if ((doc as { ownerUserId?: string }).ownerUserId !== owner) {
    throw new Error("survey_not_owned");
  }
  return { ownerUserId: owner, version: Number((doc as { version?: number }).version ?? 1) };
}

/** 新建空白调研,返回其 $id。 */
export async function createSurvey(title: string): Promise<string> {
  const owner = getOwnerUserId();
  const doc = await db().createDocument(DATABASE_ID, SURVEYS, ID.unique(), {
    ownerUserId: owner,
    projectId: DEFAULT_PROJECT,
    title: title.trim() || "未命名调研",
    status: "draft",
    flowConfig: JSON.stringify({}),
    version: 1,
    updatedAt: new Date().toISOString(),
  });
  return doc.$id;
}

async function deleteChildren(surveyId: string): Promise<void> {
  const database = db();
  const [sections, questions] = await Promise.all([
    database.listDocuments(DATABASE_ID, SECTIONS, [Query.equal("surveyId", surveyId), Query.limit(500)]),
    database.listDocuments(DATABASE_ID, QUESTIONS, [Query.equal("surveyId", surveyId), Query.limit(2000)]),
  ]);
  // Questions first (they reference sections), then sections.
  await Promise.all(
    questions.documents.map((d) => database.deleteDocument(DATABASE_ID, QUESTIONS, d.$id)),
  );
  await Promise.all(
    sections.documents.map((d) => database.deleteDocument(DATABASE_ID, SECTIONS, d.$id)),
  );
}

/** 保存提纲:全量替换 sections/questions,并更新 meta 与 version。 */
export async function saveSurveyDraft(surveyId: string, draftInput: SurveyDraft): Promise<void> {
  const draft = SurveyDraftSchema.parse(draftInput);
  const { version } = await assertOwned(surveyId);
  const database = db();

  await database.updateDocument(DATABASE_ID, SURVEYS, surveyId, {
    title: draft.title,
    flowConfig: JSON.stringify({
      researchGoal: draft.researchGoal,
      targetAudience: draft.targetAudience,
      introScript: draft.introScript,
    }),
    version: version + 1,
    updatedAt: new Date().toISOString(),
  });

  await deleteChildren(surveyId);

  let globalOrder = 0;
  for (let si = 0; si < draft.sections.length; si++) {
    const section = draft.sections[si];
    const sectionDoc = await database.createDocument(DATABASE_ID, SECTIONS, ID.unique(), {
      surveyId,
      title: section.title,
      description: section.objective,
      order: si,
    });
    for (let qi = 0; qi < section.questions.length; qi++) {
      const q = section.questions[qi];
      await database.createDocument(DATABASE_ID, QUESTIONS, ID.unique(), {
        surveyId,
        sectionId: sectionDoc.$id,
        order: globalOrder++,
        orderInSection: qi,
        type: q.questionType,
        prompt: q.questionText,
        config: JSON.stringify({ options: q.options, allowSkip: q.allowSkip }),
        probeConfig: JSON.stringify({
          level: q.probeLevel,
          instruction: q.probeInstruction,
          maxRounds: q.probeLevel === "deep" ? 5 : 3,
        }),
        stimulus: q.stimulus ? JSON.stringify(q.stimulus) : undefined,
        probingPolicy: JSON.stringify({}),
        skipLogic: JSON.stringify({}),
      });
    }
  }
}

/** 切换调研状态。 */
export async function updateSurveyStatus(surveyId: string, status: EditorStatus): Promise<void> {
  await assertOwned(surveyId);
  await db().updateDocument(DATABASE_ID, SURVEYS, surveyId, {
    status: toAppwriteStatus(status),
    updatedAt: new Date().toISOString(),
  });
}

/** 删除调研及其分节/问题。 */
export async function deleteSurvey(surveyId: string): Promise<void> {
  await assertOwned(surveyId);
  await deleteChildren(surveyId);
  await db().deleteDocument(DATABASE_ID, SURVEYS, surveyId);
}
