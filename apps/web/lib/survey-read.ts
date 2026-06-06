import type {
  Survey,
  SurveySection,
  QuestionBlock,
  SurveyDraft,
  InterviewSession,
  Transcript,
} from "@merism/contracts";
import { getServerClient, DATABASE_ID, Query } from "@/lib/queries/client";
import { getOwnerUserId } from "@/lib/owner";
import { assembleSurveyDraft } from "@/lib/survey-draft";

/**
 * 编辑器读路径。直接读 Appwrite 文档并把以字符串存储的 JSON 字段
 * (`flowConfig`/`config`/`probeConfig`/`stimulus`)解析回对象,再交给
 * `assembleSurveyDraft`。
 *
 * 不复用 `lib/queries/studies.ts::getStudy`:那里按对象形态做 schema 校验,
 * 不解析字符串 JSON(对真实 Appwrite 文档会失败)。本加载器只服务编辑器,
 * 以 owner 作用域,容忍不完整数据。
 */

type Raw = Record<string, unknown>;

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export type EditorStatus = "draft" | "live" | "closed";

function toEditorStatus(s: unknown): EditorStatus {
  return s === "published" ? "live" : s === "archived" ? "closed" : "draft";
}

export type LoadedSurvey = {
  surveyId: string;
  title: string;
  status: EditorStatus;
  draft: SurveyDraft;
};

export async function loadSurveyDraft(surveyId: string): Promise<LoadedSurvey | null> {
  const owner = getOwnerUserId();
  const database = getServerClient().databases;

  let doc: Raw;
  try {
    doc = (await database.getDocument(DATABASE_ID, "surveys", surveyId)) as unknown as Raw;
  } catch {
    return null;
  }
  if (doc.ownerUserId !== owner) return null;

  const survey: Survey = {
    $id: String(doc.$id),
    projectId: String(doc.projectId ?? ""),
    title: String(doc.title ?? ""),
    status: (doc.status as Survey["status"]) ?? "draft",
    flowConfig: parseJson<Record<string, unknown>>(doc.flowConfig, {}),
    version: Number(doc.version ?? 1),
    updatedAt: String(doc.updatedAt ?? new Date().toISOString()),
  };

  const [secRes, qRes] = await Promise.all([
    database.listDocuments(DATABASE_ID, "survey_sections", [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(500),
    ]),
    database.listDocuments(DATABASE_ID, "question_blocks", [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(2000),
    ]),
  ]);

  const sections = secRes.documents.map((raw) => {
    const d = raw as unknown as Raw;
    return {
      $id: String(d.$id),
      surveyId: String(d.surveyId),
      title: String(d.title ?? ""),
      description: String(d.description ?? ""),
      order: Number(d.order ?? 0),
    } satisfies SurveySection;
  });

  const questions = qRes.documents.map((raw) => {
    const d = raw as unknown as Raw;
    return {
      $id: String(d.$id),
      surveyId: String(d.surveyId),
      sectionId: String(d.sectionId),
      order: Number(d.order ?? 0),
      orderInSection: Number(d.orderInSection ?? 0),
      type: d.type,
      prompt: String(d.prompt ?? ""),
      config: parseJson<Record<string, unknown>>(d.config, {}),
      probeConfig: parseJson(d.probeConfig, undefined),
      stimulus: parseJson(d.stimulus, undefined),
      probingPolicy: parseJson<Record<string, unknown>>(d.probingPolicy, {}),
      skipLogic: parseJson<Record<string, unknown>>(d.skipLogic, {}),
    } as unknown as QuestionBlock;
  });

  return {
    surveyId,
    title: survey.title,
    status: toEditorStatus(doc.status),
    draft: assembleSurveyDraft(survey, sections, questions),
  };
}

export type SurveyMeta = { surveyId: string; title: string; status: EditorStatus };

/** 轻量读取:只取 survey meta(标题/状态),供工作台 layout 顶栏使用。 */
export async function loadSurveyMeta(surveyId: string): Promise<SurveyMeta | null> {
  const owner = getOwnerUserId();
  const database = getServerClient().databases;
  let doc: Raw;
  try {
    doc = (await database.getDocument(DATABASE_ID, "surveys", surveyId)) as unknown as Raw;
  } catch {
    return null;
  }
  if (doc.ownerUserId !== owner) return null;
  return { surveyId, title: String(doc.title ?? ""), status: toEditorStatus(doc.status) };
}

export type SurveyListItem = {
  id: string;
  title: string;
  status: EditorStatus;
  responses: number;
};

/** 列出当前 owner 的全部调研(首页/侧边栏用)。 */
export async function listSurveysForOwner(): Promise<SurveyListItem[]> {
  const owner = getOwnerUserId();
  const database = getServerClient().databases;
  const res = await database.listDocuments(DATABASE_ID, "surveys", [
    Query.equal("ownerUserId", owner),
    Query.orderDesc("updatedAt"),
    Query.limit(100),
  ]);
  return res.documents.map((raw) => {
    const d = raw as unknown as Raw;
    return {
      id: String(d.$id),
      title: String(d.title ?? "未命名调研"),
      status: toEditorStatus(d.status),
      responses: 0,
    };
  });
}

/** 调研的有序问题引用(id + prompt),用于结果表头/答案列对齐。 */
export async function listQuestionRefs(surveyId: string): Promise<{ id: string; prompt: string }[]> {
  const database = getServerClient().databases;
  const res = await database.listDocuments(DATABASE_ID, "question_blocks", [
    Query.equal("surveyId", surveyId),
    Query.orderAsc("order"),
    Query.limit(2000),
  ]);
  return res.documents.map((raw) => {
    const d = raw as unknown as Raw;
    return { id: String(d.$id), prompt: String(d.prompt ?? "") };
  });
}

/** 按 id 读取单个 session(collectedAnswers 解析为对象)。 */
export async function getSessionById(sessionId: string): Promise<InterviewSession | null> {
  const database = getServerClient().databases;
  let d: Raw;
  try {
    d = (await database.getDocument(DATABASE_ID, "interview_sessions", sessionId)) as unknown as Raw;
  } catch {
    return null;
  }
  return {
    $id: String(d.$id),
    surveyId: String(d.surveyId),
    linkId: String(d.linkId ?? ""),
    state: (d.state as InterviewSession["state"]) ?? "created",
    livekitRoom: String(d.livekitRoom ?? ""),
    collectedAnswers: parseJson<Record<string, unknown>>(d.collectedAnswers, {}),
    startedAt: d.startedAt ? String(d.startedAt) : undefined,
    endedAt: d.endedAt ? String(d.endedAt) : undefined,
  } as InterviewSession;
}

/** 取某 session 的转录(segments 解析为数组)。 */
export async function getTranscriptBySession(sessionId: string): Promise<Transcript | null> {
  const database = getServerClient().databases;
  const res = await database.listDocuments(DATABASE_ID, "transcripts", [
    Query.equal("sessionId", sessionId),
    Query.limit(1),
  ]);
  const raw = res.documents[0];
  if (!raw) return null;
  const d = raw as unknown as Raw;
  return {
    $id: String(d.$id),
    sessionId: String(d.sessionId),
    segments: parseJson<Transcript["segments"]>(d.segments, []),
    language: String(d.language ?? "中文"),
    finalizedAt: String(d.finalizedAt ?? new Date().toISOString()),
  };
}
