// Smoke path: with a running stack + applied schema, create a researcher, a
// minimal survey/block/link, then issue a LiveKit token via the real function
// logic. Asserts a sessionId + token come back. Run via scripts/smoke.sh.
import { ID, Permission, Role, Users } from "node-appwrite";
import { databases, serverClient, loadDotEnv } from "../packages/appwrite-schema/src/client.js";
import { issueLivekitToken } from "../apps/functions/issueLivekitToken/src/handler.js";
import { createRealDeps } from "../apps/functions/issueLivekitToken/src/deps.js";

const DB = "merism";

async function main(): Promise<void> {
  loadDotEnv();
  const db = databases();
  const users = new Users(serverClient());
  const stamp = Date.now();

  const owner = await users.create(ID.unique(), `smoke_${stamp}@example.com`, undefined, "pw12345678", "Smoke");
  const ownerPerms = [Permission.read(Role.user(owner.$id)), Permission.update(Role.user(owner.$id))];

  const project = await db.createDocument(DB, "projects", ID.unique(), {
    ownerUserId: owner.$id,
    name: "Smoke Project",
    createdAt: new Date().toISOString(),
  }, ownerPerms);

  const survey = await db.createDocument(DB, "surveys", ID.unique(), {
    projectId: project.$id,
    title: "Smoke Survey",
    status: "published",
    updatedAt: new Date().toISOString(),
  }, ownerPerms);

  const section = await db.createDocument(DB, "survey_sections", ID.unique(), {
    surveyId: survey.$id,
    title: "Smoke Section",
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

  const result = await issueLivekitToken({ linkToken: token }, createRealDeps());
  if (result.status !== 200) throw new Error(`expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
  if (!result.body.sessionId || !result.body.token) throw new Error("missing sessionId or token");

  console.log(`session=${result.body.sessionId} token=${result.body.token.slice(0, 6)}***`);
  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
