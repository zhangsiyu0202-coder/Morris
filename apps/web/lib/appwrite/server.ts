import { Client, Databases, ID, Permission, Role } from "node-appwrite";
import {
  SurveyDraftSchema,
  SurveyDraftSectionSchema,
} from "@merism/contracts";
import { z } from "zod";

type SurveyDraft = z.infer<typeof SurveyDraftSchema>;
type SurveyDraftSection = z.infer<typeof SurveyDraftSectionSchema>;

const DATABASE_ID = "merism";
const DEFAULT_OWNER_USER_ID = "demo-researcher";
export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_SURVEY_ID = "default-survey-draft";

function reqEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing env ${name}`);
  }
  return value;
}

export function serverDatabases(): Databases {
  const client = new Client()
    .setEndpoint(reqEnv("APPWRITE_ENDPOINT"))
    .setProject(reqEnv("APPWRITE_PROJECT_ID"))
    .setKey(reqEnv("APPWRITE_API_KEY"));

  return new Databases(client);
}

function ownerPermissions(ownerUserId: string = DEFAULT_OWNER_USER_ID): string[] {
  return [Permission.read(Role.user(ownerUserId)), Permission.write(Role.user(ownerUserId))];
}

function parseJsonString<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadStudyDraft(
  surveyId: string = DEFAULT_SURVEY_ID,
): Promise<SurveyDraft | null> {
  const db = serverDatabases();
  const survey = (await db.getDocument(DATABASE_ID, "surveys", surveyId).catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!survey) {
    return null;
  }

  const sectionsRes = await db.listDocuments(DATABASE_ID, "survey_sections", []);
  const questionsRes = await db.listDocuments(DATABASE_ID, "question_blocks", []);
  const sections = sectionsRes.documents
    .filter((doc: any) => doc.surveyId === surveyId)
    .sort((a: any, b: any) => a.order - b.order);
  const questions = questionsRes.documents
    .filter((doc: any) => doc.surveyId === surveyId)
    .sort((a: any, b: any) => a.order - b.order);

  const flowConfig = parseJsonString<{
    researchGoal?: string;
    targetAudience?: string;
    introScript?: string;
  }>(survey.flowConfig, {});

  return SurveyDraftSchema.parse({
    title: survey.title,
    researchGoal: flowConfig.researchGoal ?? "Describe the research outcome you want from this interview study.",
    targetAudience: flowConfig.targetAudience ?? "Describe who should participate in the study.",
    introScript:
      flowConfig.introScript ??
      "Thank you for joining. I want to learn from your experience in your own words.",
    sections: sections.map((section: any) => ({
      title: section.title,
      objective: section.description || section.sectionInstruction || "",
      questions: questions
        .filter((question: any) => question.sectionId === section.$id)
        .sort((a: any, b: any) => a.orderInSection - b.orderInSection)
        .map((question: any) => {
          const config = parseJsonString<{ options?: string[] }>(question.config, {});
          const probeConfig = parseJsonString<{ level?: "none" | "follow_up" | "deep"; instruction?: string }>(
            question.probeConfig,
            {},
          );

          return {
            questionText: question.prompt,
            questionType: question.type,
            probeLevel:
              probeConfig.level ??
              (probeConfig.instruction ? "follow_up" : "none"),
            probeInstruction: probeConfig.instruction ?? "",
            options: config.options ?? [],
          };
        }),
    })),
  });
}

export async function saveStudyDraft(
  draft: SurveyDraft,
  {
    projectId = DEFAULT_PROJECT_ID,
    surveyId = DEFAULT_SURVEY_ID,
    ownerUserId = DEFAULT_OWNER_USER_ID,
  }: {
    projectId?: string;
    surveyId?: string;
    ownerUserId?: string;
  } = {},
): Promise<{ projectId: string; surveyId: string }> {
  const db = serverDatabases();
  const permissions = ownerPermissions(ownerUserId);
  const now = new Date().toISOString();

  await db
    .getDocument(DATABASE_ID, "projects", projectId)
    .catch(async () =>
      db.createDocument(
        DATABASE_ID,
        "projects",
        projectId,
        {
          ownerUserId,
          name: "Default project",
          description: "Default project for survey design drafts.",
          createdAt: now,
        },
        permissions,
      ),
    );

  await db
    .getDocument(DATABASE_ID, "surveys", surveyId)
    .then(() =>
      db.updateDocument(DATABASE_ID, "surveys", surveyId, {
        title: draft.title,
        status: "draft",
        flowConfig: JSON.stringify({
          researchGoal: draft.researchGoal,
          targetAudience: draft.targetAudience,
          introScript: draft.introScript,
        }),
        version: 1,
        updatedAt: now,
      }),
    )
    .catch(async () =>
      db.createDocument(
        DATABASE_ID,
        "surveys",
        surveyId,
        {
          projectId,
          title: draft.title,
          status: "draft",
          flowConfig: JSON.stringify({
            researchGoal: draft.researchGoal,
            targetAudience: draft.targetAudience,
            introScript: draft.introScript,
          }),
          version: 1,
          updatedAt: now,
        },
        permissions,
      ),
    );

  const existingSections = await db.listDocuments(DATABASE_ID, "survey_sections", []);
  const existingQuestions = await db.listDocuments(DATABASE_ID, "question_blocks", []);

  await Promise.all(
    existingQuestions.documents
      .filter((doc: any) => doc.surveyId === surveyId)
      .map((doc: any) => db.deleteDocument(DATABASE_ID, "question_blocks", doc.$id)),
  );
  await Promise.all(
    existingSections.documents
      .filter((doc: any) => doc.surveyId === surveyId)
      .map((doc: any) => db.deleteDocument(DATABASE_ID, "survey_sections", doc.$id)),
  );

  for (const [sectionIndex, section] of draft.sections.entries()) {
    const sectionId = `section-${sectionIndex + 1}`;
    await db.createDocument(
      DATABASE_ID,
      "survey_sections",
      sectionId,
      {
        surveyId,
        title: section.title,
        description: section.objective,
        order: sectionIndex,
        sectionInstruction: section.objective,
      },
      permissions,
    );

    for (const [questionIndex, question] of section.questions.entries()) {
      await db.createDocument(
        DATABASE_ID,
        "question_blocks",
        `question-${sectionIndex + 1}-${questionIndex + 1}`,
        {
          surveyId,
          sectionId,
          order: draft.sections
            .slice(0, sectionIndex)
            .reduce((count, current) => count + current.questions.length, 0) + questionIndex,
          orderInSection: questionIndex,
          type: question.questionType,
          prompt: question.questionText,
          config: JSON.stringify({ options: question.options }),
          probeConfig: JSON.stringify({
            level: question.probeLevel,
            instruction: question.probeInstruction,
          }),
          probingPolicy: "{}",
          skipLogic: "{}",
        },
        permissions,
      );
    }
  }

  return { projectId, surveyId };
}
