// Stress smoke (Concurrency contract — architecture.md): fire K concurrent
// issueLivekitToken calls against a single reusable link with maxUses=N where
// K > N. Expect exactly N to succeed (200) and the rest to be 410 with
// `link_exhausted`. Run via:
//   SMOKE_SKIP_STACK=1 pnpm exec tsx scripts/smoke-stress.mts
//
// This exists alongside scripts/smoke.mts because the property tests for the
// pure handler exercise the contract with in-memory deps; this one exercises
// the live SDK wrapper (Appwrite document-id collisions on createSession +
// LiveKit createRoom + token sign) end-to-end against the running stack.
import { ID, Permission, Role, Users } from "node-appwrite";
import { databases, serverClient, loadDotEnv } from "../packages/appwrite-schema/src/client.js";
import { issueLivekitToken } from "../apps/functions/issueLivekitToken/src/handler.js";
import { createRealDeps } from "../apps/functions/issueLivekitToken/src/deps.js";

const DB = "merism";
const MAX_USES = 3;
const CONCURRENT = 6; // > MAX_USES so we exercise the exhaustion path

async function main(): Promise<void> {
  loadDotEnv();
  const db = databases();
  const users = new Users(serverClient());
  const stamp = Date.now();

  const owner = await users.create(
    ID.unique(),
    `stress_${stamp}@example.com`,
    undefined,
    "pw12345678",
    "Stress",
  );
  const ownerPerms = [Permission.read(Role.user(owner.$id)), Permission.update(Role.user(owner.$id))];

  const project = await db.createDocument(
    DB,
    "projects",
    ID.unique(),
    { ownerUserId: owner.$id, name: "Stress", createdAt: new Date().toISOString() },
    ownerPerms,
  );
  const survey = await db.createDocument(
    DB,
    "surveys",
    ID.unique(),
    {
      ownerUserId: owner.$id,
      projectId: project.$id,
      title: "Stress Survey",
      status: "published",
      flowConfig: JSON.stringify({
        researchGoal: "concurrency contract",
        targetAudience: "stress test",
        introScript: "go",
      }),
      updatedAt: new Date().toISOString(),
    },
    ownerPerms,
  );
  const section = await db.createDocument(
    DB,
    "survey_sections",
    ID.unique(),
    { surveyId: survey.$id, title: "S", description: "section objective", order: 0 },
    ownerPerms,
  );
  await db.createDocument(
    DB,
    "question_blocks",
    ID.unique(),
    {
      surveyId: survey.$id,
      sectionId: section.$id,
      order: 0,
      orderInSection: 0,
      type: "open_ended",
      prompt: "Stress prompt?",
    },
    ownerPerms,
  );
  const token = `stress-${stamp}`;
  await db.createDocument(DB, "interview_links", ID.unique(), {
    surveyId: survey.$id,
    token,
    mode: "reusable",
    maxUses: MAX_USES,
    expiresAt: new Date(stamp + 3_600_000).toISOString(),
  });

  // Single shared deps instance: same SDK clients all calls collide through.
  const deps = createRealDeps();

  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, () => issueLivekitToken({ linkToken: token }, deps)),
  );

  const ok = results.filter((r) => r.status === 200);
  const exhausted = results.filter((r) => r.status === 410 && (r.body as any).error === "link_exhausted");
  const other = results.filter((r) => r.status !== 200 && !(r.status === 410 && (r.body as any).error === "link_exhausted"));

  // Concurrency contract: exactly MAX_USES tokens issued; the rest are exhausted.
  // No "internal_error", no duplicate sessionIds, no orphan sessions claimed.
  if (ok.length !== MAX_USES) {
    throw new Error(`expected ${MAX_USES} 200s, got ${ok.length}: ${JSON.stringify(results)}`);
  }
  if (exhausted.length !== CONCURRENT - MAX_USES) {
    throw new Error(
      `expected ${CONCURRENT - MAX_USES} link_exhausted, got ${exhausted.length}: ${JSON.stringify(results)}`,
    );
  }
  if (other.length > 0) {
    throw new Error(`unexpected non-200 / non-exhausted: ${JSON.stringify(other)}`);
  }

  // sessionIds must be exactly the slot ids 0..MAX_USES-1, all distinct.
  const sessionIds = new Set(ok.map((r) => (r.body as any).sessionId as string));
  if (sessionIds.size !== MAX_USES) {
    throw new Error(`expected ${MAX_USES} distinct sessionIds, got ${sessionIds.size}`);
  }
  for (let k = 0; k < MAX_USES; k++) {
    const expected = `s_*_${k}`; // wildcarded; the linkId is ID.unique()
    if (!Array.from(sessionIds).some((id) => id.endsWith(`_${k}`))) {
      throw new Error(`missing slot ${k} (pattern ${expected})`);
    }
  }

  console.log(
    `STRESS OK  concurrent=${CONCURRENT}  maxUses=${MAX_USES}  ok=${ok.length}  exhausted=${exhausted.length}`,
  );
}

main().catch((e) => {
  console.error("STRESS FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
