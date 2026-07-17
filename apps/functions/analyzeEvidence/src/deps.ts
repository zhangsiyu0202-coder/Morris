import { createHash } from "node:crypto";
import { Client, Databases, Permission, Query, Role } from "node-appwrite";
import { createLiteLlmProvider } from "@merism/llm";
import { generateText, Output } from "ai";
import { createLogger, withLLMCall } from "@merism/observability";
import {
  EvidenceExtractionOutputSchema,
  type EvidenceExtractionOutput,
} from "./evidence.js";
import type { AnalyzeEvidenceDeps, EvidenceSessionContext, EvidenceTranscriptRecord } from "./handler.js";
import { EXTRACT_ATOMIC_CLAIMS_SYSTEM, buildExtractAtomicClaimsPrompt } from "./prompts/extract-claims.js";
import { createAiHubMixJinaEmbedder } from "./providers/jina.js";

const DB = "merism";

interface Env {
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_ID: string;
  APPWRITE_API_KEY: string;
  LITELLM_API_KEY: string;
  LITELLM_BASE_URL: string;
  LITELLM_MODEL?: string;
  AIHUBMIX_API_KEY: string;
  AIHUBMIX_BASE_URL?: string;
}

function req(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`missing env ${key}`);
  return value;
}

function requireEnv(): Env {
  return {
    APPWRITE_ENDPOINT: req("APPWRITE_ENDPOINT"),
    APPWRITE_PROJECT_ID: req("APPWRITE_PROJECT_ID"),
    APPWRITE_API_KEY: req("APPWRITE_API_KEY"),
    LITELLM_API_KEY: req("LITELLM_API_KEY"),
    LITELLM_BASE_URL: req("LITELLM_BASE_URL"),
    LITELLM_MODEL: process.env.LITELLM_MODEL,
    AIHUBMIX_API_KEY: req("AIHUBMIX_API_KEY"),
    AIHUBMIX_BASE_URL: process.env.AIHUBMIX_BASE_URL,
  };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function evidenceIdentity(input: {
  transcriptId: string;
  segmentIndex: number;
  sourceText: string;
  claim: string;
  claimType: string;
  stance: string;
}) {
  const contentHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  // Appwrite document IDs are capped at 36 characters. The full digest remains
  // in contentHash and participates in the unique source-claim index.
  return { $id: `ev_${contentHash.slice(0, 32)}`, contentHash };
}

export function createRealDeps(): AnalyzeEvidenceDeps {
  const env = requireEnv();
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const db = new Databases(client);
  const litellm = createLiteLlmProvider({ apiKey: env.LITELLM_API_KEY, baseUrl: env.LITELLM_BASE_URL });
  const modelName = env.LITELLM_MODEL ?? "deepseek-v4-flash";
  const embedEvidence = createAiHubMixJinaEmbedder({
    apiKey: env.AIHUBMIX_API_KEY,
    baseUrl: env.AIHUBMIX_BASE_URL,
  });

  return {
    now: () => Date.now(),
    evidenceIdentity,
    embedEvidence,

    async findSessionContext(sessionId: string): Promise<EvidenceSessionContext | null> {
      let session: any;
      try {
        session = await db.getDocument(DB, "interview_sessions", sessionId);
      } catch (error: any) {
        if (error?.code === 404) return null;
        throw error;
      }
      try {
        const survey = (await db.getDocument(DB, "surveys", session.surveyId)) as any;
        let ownerUserId: string | undefined = survey.authorId ?? survey.ownerUserId;
        if (!ownerUserId) {
          const project = (await db.getDocument(DB, "projects", survey.projectId)) as any;
          ownerUserId = project.ownerUserId;
        }
        if (!ownerUserId) return null;
        return {
          sessionId,
          surveyId: session.surveyId,
          ownerUserId,
          workspaceId: session.workspaceId ?? survey.workspaceId ?? undefined,
          state: session.state,
          surveyTitle: survey.title,
          researchIntent: typeof survey.instruction === "string" ? survey.instruction : "",
        };
      } catch (error: any) {
        if (error?.code === 404) return null;
        throw error;
      }
    },

    async findTranscript(sessionId: string): Promise<EvidenceTranscriptRecord | null> {
      const result = await db.listDocuments(DB, "transcripts", [
        Query.equal("sessionId", sessionId),
        Query.orderDesc("finalizedAt"),
        Query.limit(1),
      ]);
      const document = result.documents[0] as any;
      if (!document) return null;
      return {
        $id: document.$id,
        sessionId: document.sessionId,
        segments: parseJson(document.segments, []),
      };
    },

    async extractAtomicClaims(input): Promise<EvidenceExtractionOutput> {
      const log = createLogger("function.analyzeEvidence.extract-claims");
      const { experimental_output } = await withLLMCall(
        {
          scope: "function.analyzeEvidence.extract-claims",
          traceId: log.traceId,
          defaultModel: modelName,
        },
        () => generateText({
          model: litellm(modelName),
          maxRetries: 2,
          experimental_output: Output.object({ schema: EvidenceExtractionOutputSchema }),
          system: EXTRACT_ATOMIC_CLAIMS_SYSTEM,
          prompt: buildExtractAtomicClaimsPrompt(input),
        }),
      );
      return EvidenceExtractionOutputSchema.parse(experimental_output);
    },

    async upsertEvidence(records) {
      for (const record of records) {
        const payload = {
          ownerUserId: record.ownerUserId,
          workspaceId: record.workspaceId,
          surveyId: record.surveyId,
          sessionId: record.sessionId,
          transcriptId: record.transcriptId,
          segmentIndex: record.segmentIndex,
          questionId: record.questionId,
          questionText: record.questionText,
          sourceText: record.sourceText,
          claim: record.claim,
          claimType: record.claimType,
          stance: record.stance,
          participantRole: record.participantRole,
          participantIndustry: record.participantIndustry,
          participantCompanySize: record.participantCompanySize,
          purchaseStatus: record.purchaseStatus,
          embedding: JSON.stringify(record.embedding),
          embeddingModel: record.embeddingModel,
          contentHash: record.contentHash,
          createdAt: record.createdAt,
        };
        const permissions = [
          Permission.read(Role.user(record.ownerUserId)),
          ...(record.workspaceId ? [Permission.read(Role.team(record.workspaceId))] : []),
        ];
        try {
          await db.createDocument(DB, "research_evidence", record.$id, payload, permissions);
        } catch (error: any) {
          if (error?.code !== 409) throw error;
          // Deterministic id handles normal retries. The unique index can also
          // report 409 under concurrent first writers, so resolve by full key.
          const existing = await db.listDocuments(DB, "research_evidence", [
            Query.equal("transcriptId", record.transcriptId),
            Query.equal("segmentIndex", record.segmentIndex),
            Query.equal("contentHash", record.contentHash),
            Query.limit(1),
          ]);
          const id = (existing.documents[0] as any)?.$id;
          if (!id) throw error;
          await db.updateDocument(DB, "research_evidence", id, payload, permissions);
        }
      }
    },
  };
}
