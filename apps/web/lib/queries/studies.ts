import type { Databases } from "node-appwrite";
import { SurveySchema, SurveySectionSchema, QuestionBlockSchema } from "@merism/contracts";
import type { Survey, SurveySection, QuestionBlock } from "@merism/contracts";
import { DATABASE_ID, getServerClient, getSessionDb, Query } from "./client";

const SURVEYS = "surveys";
const SURVEY_SECTIONS = "survey_sections";
const QUESTION_BLOCKS = "question_blocks";

function db(): Databases {
  return getServerClient().databases;
}

/**
 * Defensively parse Appwrite documents through the contract zod schema.
 * Documents that fail validation are skipped with a server log; we never
 * surface partially-decoded rows to the application.
 */
function parseAll<T>(rows: unknown[], parser: (raw: unknown) => T | null, label: string): T[] {
  const out: T[] = [];
  for (const raw of rows) {
    const parsed = parser(raw);
    if (parsed) out.push(parsed);
    else console.warn(`[queries:${label}] dropped row failing schema check`);
  }
  return out;
}

function parseSurvey(raw: unknown): Survey | null {
  const r = SurveySchema.safeParse(raw);
  return r.success ? r.data : null;
}

function parseSection(raw: unknown): SurveySection | null {
  const r = SurveySectionSchema.safeParse(raw);
  return r.success ? r.data : null;
}

function parseQuestion(raw: unknown): QuestionBlock | null {
  const r = QuestionBlockSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * List every survey the caller may read. Reads run through the caller's session
 * client, so Appwrite returns the owner's surveys plus any in their workspace
 * (Role.team) — native tenant isolation, no in-code filter. Tests inject a
 * `databases` mock representing the already-filtered result.
 */
export async function listStudies(databases?: Databases): Promise<Survey[]> {
  const dbx = databases ?? (await getSessionDb());
  const result = await dbx.listDocuments(DATABASE_ID, SURVEYS, [
    Query.orderDesc("updatedAt"),
    Query.limit(100),
  ]);
  return parseAll(result.documents, parseSurvey, "listStudies");
}

/**
 * Get a single survey plus its sections and question blocks. The survey read
 * goes through the caller's session client — Appwrite returns it only if the
 * caller may read it (owner or workspace team), which IS the authorization gate.
 * Once authorized, the child rows (sections/questions, which carry no per-row
 * permissions) are fetched by surveyId via the API-key client. Returns null when
 * the survey does not exist or the caller may not read it.
 */
export async function getStudy(
  surveyId: string,
  databases?: Databases,
): Promise<{ survey: Survey; sections: SurveySection[]; questions: QuestionBlock[] } | null> {
  const dbx = databases ?? (await getSessionDb());
  const surveyResult = await dbx.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    Query.limit(1),
  ]);
  const survey = parseSurvey(surveyResult.documents[0] ?? null);
  if (!survey) return null;

  const childDb = databases ?? db();
  const [sectionResult, questionResult] = await Promise.all([
    childDb.listDocuments(DATABASE_ID, SURVEY_SECTIONS, [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(200),
    ]),
    childDb.listDocuments(DATABASE_ID, QUESTION_BLOCKS, [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(500),
    ]),
  ]);

  return {
    survey,
    sections: parseAll(sectionResult.documents, parseSection, "getStudy:sections"),
    questions: parseAll(questionResult.documents, parseQuestion, "getStudy:questions"),
  };
}

/**
 * Fetch a study for a *viewer*, returning the author id too (callers key the
 * report read off the author). The survey read goes through the caller's session
 * client, so Appwrite returns it only when the viewer may read it (author or
 * workspace team) — that IS the authorization. Returns null otherwise. Children
 * (sections/questions, no per-row perms) are then read by surveyId via the
 * API-key client.
 */
export async function getStudyForViewer(
  surveyId: string,
  databases?: Databases,
): Promise<{
  survey: Survey;
  sections: SurveySection[];
  questions: QuestionBlock[];
  ownerUserId: string;
} | null> {
  const dbx = databases ?? (await getSessionDb());
  const surveyResult = await dbx.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    Query.limit(1),
  ]);
  const rawSurvey = surveyResult.documents[0] ?? null;
  const survey = parseSurvey(rawSurvey);
  if (!survey) return null;

  // `ownerUserId` is the legacy author column (recast to `authorId` per
  // ADR-0006 but not in SurveySchema); read it off the raw doc.
  const legacyOwner = (rawSurvey as { ownerUserId?: string } | null)?.ownerUserId;
  const effectiveOwner = survey.authorId ?? legacyOwner ?? "";

  const childDb = databases ?? db();
  const [sectionResult, questionResult] = await Promise.all([
    childDb.listDocuments(DATABASE_ID, SURVEY_SECTIONS, [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(200),
    ]),
    childDb.listDocuments(DATABASE_ID, QUESTION_BLOCKS, [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(500),
    ]),
  ]);

  return {
    survey,
    sections: parseAll(sectionResult.documents, parseSection, "getStudyForViewer:sections"),
    questions: parseAll(questionResult.documents, parseQuestion, "getStudyForViewer:questions"),
    ownerUserId: effectiveOwner,
  };
}
