import { Client, Databases, Functions, Permission, Role } from "node-appwrite";
import type { TranscriptSegment } from "@merism/contracts";
import type { FinalizeInterviewSessionDeps } from "./handler.js";

const DB = "merism";
const DEFAULT_ANALYZE_SESSION_FN = "analyzeSession";
const DEFAULT_ANALYZE_SURVEY_FN = "analyzeSurvey";

function req(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function tenantReadPermissions(ownerUserId: string | null, workspaceId: string | null): string[] | undefined {
  if (!ownerUserId) return undefined;
  return [
    Permission.read(Role.user(ownerUserId)),
    ...(workspaceId ? [Permission.read(Role.team(workspaceId))] : []),
  ];
}

function serializeTranscript(segments: TranscriptSegment[]): string {
  return JSON.stringify(segments);
}

function serializeCollectedAnswers(collectedAnswers: Record<string, unknown>): string {
  return JSON.stringify(collectedAnswers);
}

export function createRealDeps(): FinalizeInterviewSessionDeps {
  const client = new Client()
    .setEndpoint(req("APPWRITE_ENDPOINT"))
    .setProject(req("APPWRITE_PROJECT_ID"))
    .setKey(req("APPWRITE_API_KEY"));
  const databases = new Databases(client);
  const functions = new Functions(client);

  return {
    nowIso: () => new Date().toISOString(),

    async resolveSurveyTenancy(surveyId) {
      const survey = (await databases.getDocument(DB, "surveys", surveyId)) as Record<string, unknown>;
      const projectId = typeof survey.projectId === "string" ? survey.projectId : null;
      const surveyOwnerUserId = typeof survey.ownerUserId === "string" ? survey.ownerUserId : null;
      const surveyWorkspaceId = typeof survey.workspaceId === "string" ? survey.workspaceId : null;
      if (surveyOwnerUserId || surveyWorkspaceId || !projectId) {
        return { ownerUserId: surveyOwnerUserId, workspaceId: surveyWorkspaceId };
      }
      const project = (await databases.getDocument(DB, "projects", projectId)) as Record<string, unknown>;
      return {
        ownerUserId: typeof project.ownerUserId === "string" ? project.ownerUserId : null,
        workspaceId: typeof project.workspaceId === "string" ? project.workspaceId : null,
      };
    },

    async upsertTranscript({ sessionId, segments, language, finalizedAt, ownerUserId, workspaceId }) {
      const data = {
        sessionId,
        segments: serializeTranscript(segments),
        language,
        finalizedAt,
      };
      const permissions = tenantReadPermissions(ownerUserId, workspaceId);
      try {
        await databases.createDocument(DB, "transcripts", sessionId, data, permissions);
      } catch (error: any) {
        if (error?.code !== 409) throw error;
        await databases.updateDocument(DB, "transcripts", sessionId, data);
      }
    },

    async deleteTranscript(sessionId) {
      await databases.deleteDocument(DB, "transcripts", sessionId);
    },

    async completeSession({ sessionId, state, collectedAnswers, endedAt }) {
      await databases.updateDocument(DB, "interview_sessions", sessionId, {
        state,
        collectedAnswers: serializeCollectedAnswers(collectedAnswers),
        endedAt,
      });
    },

    async upsertRecording({ sessionId, ownerUserId, workspaceId, storageFileId, durationMs, format }) {
      const data = {
        sessionId,
        ownerUserId,
        storageFileId,
        durationMs,
        format,
        ...(workspaceId ? { workspaceId } : {}),
      };
      const permissions = tenantReadPermissions(ownerUserId, workspaceId);
      try {
        await databases.createDocument(DB, "recordings", sessionId, data, permissions);
      } catch (error: any) {
        if (error?.code !== 409) throw error;
        await databases.updateDocument(DB, "recordings", sessionId, data);
      }
    },

    async createUsageEvent({ eventId, workspaceId, studyId, sessionId, occurredAt }) {
      await databases.createDocument(DB, "usage_events", eventId, {
        workspaceId,
        studyId,
        sessionId,
        unit: "completed_interview",
        occurredAt,
      });
    },

    async triggerPostSessionAnalysis(sessionId, surveyId) {
      await functions.createExecution(
        process.env.ANALYZE_SESSION_FUNCTION_ID ?? DEFAULT_ANALYZE_SESSION_FN,
        JSON.stringify({ sessionId }),
        true,
        undefined,
        "POST" as never,
        { "content-type": "application/json" },
      );
      await functions.createExecution(
        process.env.ANALYZE_SURVEY_FUNCTION_ID ?? DEFAULT_ANALYZE_SURVEY_FN,
        JSON.stringify({ surveyId }),
        true,
        undefined,
        "POST" as never,
        { "content-type": "application/json" },
      );
    },
  };
}
