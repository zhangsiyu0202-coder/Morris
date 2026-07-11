// Smoke path: with a running stack + applied schema + deployed Appwrite
// Functions, create a researcher, a minimal survey/block/link, then issue a
// LiveKit token and finalize the session through deployed execution surfaces.
// Asserts the session row and transcript are finalized. Run via scripts/smoke.sh.
import { ID, Permission, Role, Users, Functions } from "node-appwrite";
import { databases, serverClient, loadDotEnv } from "../packages/appwrite-schema/src/client.js";
import {
  FinalizeInterviewSessionResponseSchema,
  IssueLivekitTokenResponseSchema,
} from "@merism/contracts";

const DB = "merism";
const FUNCTION_ID = process.env.ISSUE_TOKEN_FUNCTION_ID || "issueLivekitToken";
const FINALIZE_FUNCTION_ID = process.env.FINALIZE_INTERVIEW_SESSION_FUNCTION_ID || "finalizeInterviewSession";

async function waitForDeployment(functionId: string, timeoutMs = 180_000): Promise<void> {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) throw new Error("missing APPWRITE_* env for deployment wait");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${endpoint}/functions/${functionId}/deployments`, {
      headers: {
        "X-Appwrite-Project": projectId,
        "X-Appwrite-Key": apiKey,
      },
    });
    if (!res.ok) throw new Error(`failed to read deployments for ${functionId}: ${res.status}`);
    const body = await res.json() as { deployments?: Array<{ status?: string }> };
    const status = body.deployments?.[0]?.status;
    if (status === "ready") return;
    if (status === "failed") throw new Error(`deployment failed for ${functionId}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`deployment timed out for ${functionId}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const db = databases();
  const users = new Users(serverClient());
  const functions = new Functions(serverClient());
  const stamp = Date.now();

  await waitForDeployment(FUNCTION_ID);
  await waitForDeployment(FINALIZE_FUNCTION_ID);

  const owner = await users.create(ID.unique(), `smoke_${stamp}@example.com`, undefined, "pw12345678", "Smoke");
  const ownerPerms = [Permission.read(Role.user(owner.$id)), Permission.update(Role.user(owner.$id))];

  const project = await db.createDocument(DB, "projects", ID.unique(), {
    ownerUserId: owner.$id,
    name: "Smoke Project",
    createdAt: new Date().toISOString(),
  }, ownerPerms);

  const survey = await db.createDocument(DB, "surveys", ID.unique(), {
    ownerUserId: owner.$id,
    projectId: project.$id,
    title: "Smoke Survey",
    status: "published",
    // SurveyDraftSchema enforces researchGoal/targetAudience/introScript non-empty
    // (validated inside issueLivekitToken.deps.createRoom). Provide minimal text.
    flowConfig: JSON.stringify({
      researchGoal: "smoke test research goal",
      targetAudience: "smoke test audience",
      introScript: "smoke test intro",
    }),
    updatedAt: new Date().toISOString(),
  }, ownerPerms);

  const section = await db.createDocument(DB, "survey_sections", ID.unique(), {
    surveyId: survey.$id,
    title: "Smoke Section",
    // SurveyDraftSectionSchema.objective requires non-empty (mapped from
    // section.description || section.sectionInstruction in createRoom deps).
    description: "smoke test section objective",
    order: 0,
  }, ownerPerms);

  await db.createDocument(DB, "question_blocks", ID.unique(), {
    surveyId: survey.$id,
    sectionId: section.$id,
    order: 0,
    orderInSection: 0,
    type: "open_ended",
    prompt: "How was your day?",
  }, ownerPerms);

  const token = `smoke-${stamp}`;
  await db.createDocument(DB, "interview_links", ID.unique(), {
    surveyId: survey.$id,
    token,
    mode: "single_use",
    maxUses: 1,
    expiresAt: new Date(stamp + 3_600_000).toISOString(),
  });

  const execution = await functions.createExecution(
    FUNCTION_ID,
    JSON.stringify({ linkToken: token }),
    false,
    undefined,
    "POST" as never,
    { "content-type": "application/json" },
  );
  if (execution.responseStatusCode !== 200) {
    throw new Error(`expected 200, got ${execution.responseStatusCode}: ${execution.responseBody}`);
  }
  const parsed = IssueLivekitTokenResponseSchema.safeParse(JSON.parse(execution.responseBody));
  if (!parsed.success) throw new Error("invalid issueLivekitToken response body");

  const finalizeExecution = await functions.createExecution(
    FINALIZE_FUNCTION_ID,
    JSON.stringify({
      sessionId: parsed.data.sessionId,
      surveyId: survey.$id,
      state: "completed",
      collectedAnswers: { q1: { answer: "good" } },
      transcript: {
        segments: [{ speaker: "respondent", startMs: 0, endMs: 1000, text: "good" }],
        language: "zh",
      },
      durationMs: 90_000,
      answeredCount: 1,
    }),
    false,
    undefined,
    "POST" as never,
    { "content-type": "application/json" },
  );
  if (finalizeExecution.responseStatusCode !== 200) {
    throw new Error(`finalize expected 200, got ${finalizeExecution.responseStatusCode}: ${finalizeExecution.responseBody}`);
  }
  const finalized = FinalizeInterviewSessionResponseSchema.safeParse(JSON.parse(finalizeExecution.responseBody));
  if (!finalized.success) throw new Error("invalid finalizeInterviewSession response body");

  const session = await db.getDocument(DB, "interview_sessions", parsed.data.sessionId) as Record<string, unknown>;
  if (session.state !== "completed") throw new Error(`session not finalized: ${String(session.state)}`);
  const transcript = await db.getDocument(DB, "transcripts", parsed.data.sessionId) as Record<string, unknown>;
  if (typeof transcript.segments !== "string" || !transcript.segments.includes("good")) {
    throw new Error("transcript not finalized");
  }

  console.log(`session=${parsed.data.sessionId} token=${parsed.data.token.slice(0, 6)}***`);
  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
