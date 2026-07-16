/**
 * One-off local seed: a COMPLETE published survey (valid SurveyDraft fields) +
 * project + a fresh reusable interview link, for manual live interview testing.
 * Usage: set -a && . ./.env && set +a && pnpm exec tsx scripts/seed-interview-link.ts
 */
import { Client, Databases, ID, Query } from "node-appwrite";

const DB = "merism";
const OWNER = process.env.MERISM_OWNER_USER_ID || "researcher-dev";
const APP_URL = process.env.APP_URL || "http://localhost:3000";
// Reuse an existing project row (its ownerUserId only gates session read perms;
// the interviewee is anonymous). Avoids the projects collection's required
// createdAt attribute.
const PROJECT_ID = "6a2fcb8c0000fb5747d2";

const db = new Databases(
  new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!),
);

async function main() {
  const survey = await db.createDocument(DB, "surveys", ID.unique(), {
    ownerUserId: OWNER,
    projectId: PROJECT_ID,
    title: "语音访谈联通测试",
    status: "published",
    // Kept only for compatibility with persisted draft rows; the issued room
    // metadata is rebuilt from `instruction` + sections/questions below.
    flowConfig: JSON.stringify({
      researchGoal: "验证语音访谈全链路(ASR/LLM/TTS)是否跑通",
      targetAudience: "内部测试人员",
      introScript: "你好,这是一次语音访谈的联通测试。",
    }),
    instruction:
      "## 研究意图\n验证语音访谈端到端链路。\n\n## 访谈对象\n内部测试人员。\n\n## 主持行为要点\n- 一次只问一个问题\n- 回答后简短确认\n- 语气自然、有耐心",
    version: 1,
    updatedAt: new Date().toISOString(),
  });

  const section = await db.createDocument(DB, "survey_sections", ID.unique(), {
    surveyId: survey.$id,
    title: "联通测试",
    description: "确认能听清、能回应",
    order: 0,
  });

  const questions = [
    { prompt: "你好,能听到我说话吗?请简单说一句话。", type: "open_ended", deep: false },
    { prompt: "今天过得怎么样?随便聊聊。", type: "open_ended", deep: true },
  ];
  let order = 0;
  for (const q of questions) {
    await db.createDocument(DB, "question_blocks", ID.unique(), {
      surveyId: survey.$id,
      sectionId: section.$id,
      order: order,
      orderInSection: order,
      type: q.type,
      prompt: q.prompt,
      config: JSON.stringify({ options: [], allowSkip: false }),
      probeConfig: JSON.stringify({ level: q.deep ? "deep" : "standard", instruction: "", maxRounds: q.deep ? 5 : 3 }),
      probingPolicy: JSON.stringify({}),
      skipLogic: JSON.stringify({}),
    });
    order++;
  }

  const token = `livetest-${Date.now()}`;
  await db.createDocument(DB, "interview_links", ID.unique(), {
    surveyId: survey.$id,
    token,
    mode: "reusable",
    kind: "test",
    maxUses: 100,
    usedCount: 0,
    expiresAt: "2027-01-01T00:00:00.000Z",
    isRevoked: false,
  });

  console.log("surveyId:", survey.$id);
  console.log("token:", token);
  console.log("URL:", `${APP_URL}/interview?link=${token}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
