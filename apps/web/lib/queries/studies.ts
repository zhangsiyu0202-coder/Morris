import type { Databases } from "node-appwrite";
import { SurveySchema, SurveySectionSchema, QuestionBlockSchema } from "@merism/contracts";
import type { Survey, SurveySection, QuestionBlock } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "./client";

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

/** List every survey owned by `ownerUserId`. */
export async function listStudies(
  ownerUserId: string,
  databases: Databases = db(),
): Promise<Survey[]> {
  const result = await databases.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("ownerUserId", ownerUserId),
    Query.orderDesc("updatedAt"),
    Query.limit(100),
  ]);
  return parseAll(result.documents, parseSurvey, "listStudies");
}

/**
 * Get a single survey plus its sections and question blocks. Returns null when
 * the survey does not exist or is not owned by `ownerUserId`. Used by the
 * analyze Functions and by the report viewer to render question-level
 * structure.
 */
export async function getStudy(
  ownerUserId: string,
  surveyId: string,
  databases: Databases = db(),
): Promise<{ survey: Survey; sections: SurveySection[]; questions: QuestionBlock[] } | null> {
  const surveyResult = await databases.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    Query.equal("ownerUserId", ownerUserId),
    Query.limit(1),
  ]);
  const survey = parseSurvey(surveyResult.documents[0] ?? null);
  if (!survey) return null;

  const [sectionResult, questionResult] = await Promise.all([
    databases.listDocuments(DATABASE_ID, SURVEY_SECTIONS, [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(200),
    ]),
    databases.listDocuments(DATABASE_ID, QUESTION_BLOCKS, [
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
 * Fetch a study for a *viewer* who may be the author or another member of the
 * study's workspace (ADR-0006 read=team). Returns null when the study does not
 * exist or the viewer is neither its author nor a member of its workspace.
 *
 * Authorization is resolved here in code because server reads use the API key
 * (which bypasses Appwrite document permissions). Callers pass their own
 * resolved `workspaceId`, so a viewer can only ever reach studies in their own
 * workspace. Legacy studies without a `workspaceId` stay author-only.
 */
export async function getStudyForViewer(
  surveyId: string,
  viewer: { userId: string; workspaceId: string | null },
  databases: Databases = db(),
): Promise<{
  survey: Survey;
  sections: SurveySection[];
  questions: QuestionBlock[];
  ownerUserId: string;
} | null> {
  const surveyResult = await databases.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    Query.limit(1),
  ]);
  const rawSurvey = surveyResult.documents[0] ?? null;
  const survey = parseSurvey(rawSurvey);
  if (!survey) return null;

  // `ownerUserId` is the legacy author column (recast to `authorId` per
  // ADR-0006 but not in SurveySchema); read it off the raw doc so both old and
  // new studies authorize correctly.
  const legacyOwner = (rawSurvey as { ownerUserId?: string } | null)?.ownerUserId;
  const effectiveOwner = survey.authorId ?? legacyOwner ?? "";
  const isAuthor =
    (legacyOwner !== undefined && legacyOwner === viewer.userId) ||
    survey.authorId === viewer.userId;
  const sameWorkspace = Boolean(
    survey.workspaceId && viewer.workspaceId && survey.workspaceId === viewer.workspaceId,
  );
  if (!isAuthor && !sameWorkspace) return null;

  const [sectionResult, questionResult] = await Promise.all([
    databases.listDocuments(DATABASE_ID, SURVEY_SECTIONS, [
      Query.equal("surveyId", surveyId),
      Query.orderAsc("order"),
      Query.limit(200),
    ]),
    databases.listDocuments(DATABASE_ID, QUESTION_BLOCKS, [
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
