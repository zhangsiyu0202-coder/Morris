/**
 * 播种模拟的访谈 session 与一条 transcript(归属 dev owner 的第一个调研),
 * 用于验收结果/转录视图的真实读路径。按契约形态写入:
 * - interview_sessions.collectedAnswers 以 questionId 为键(约定,待 ai-interview-engine 定稿)
 * - transcripts.segments 为 {speaker,startMs,endMs,text}[]
 * 用法: set -a && . ./.env && set +a && pnpm exec tsx scripts/seed-sessions.ts
 */
import { Client, Databases, ID, Query } from "node-appwrite";

const DB = "merism";
const OWNER = process.env.MERISM_OWNER_USER_ID || "researcher-dev";
const db = new Databases(
  new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!),
);

async function main() {
  const surveys = await db.listDocuments(DB, "surveys", [
    Query.equal("ownerUserId", OWNER),
    Query.orderDesc("updatedAt"),
    Query.limit(1),
  ]);
  const survey = surveys.documents[0];
  if (!survey) throw new Error("no survey for owner; run seed-survey first");
  const surveyId = survey.$id;

  const qs = await db.listDocuments(DB, "question_blocks", [
    Query.equal("surveyId", surveyId),
    Query.orderAsc("order"),
    Query.limit(2000),
  ]);
  const questionIds = qs.documents.map((d) => d.$id);

  const sampleAnswers = [
    "我一般先看 Airbnb,再看 Booking 比价。",
    "最烦的是结账时价格忽然跳涨,还有隐藏费用。",
    "更偏好民宿,空间大也更有当地感。",
    "我会先按价格和评分筛一遍,再看图和评论。",
    "完成挺顺利的,大概打 4 分。",
  ];
  const answersFor = () =>
    JSON.stringify(Object.fromEntries(questionIds.map((id, i) => [id, sampleAnswers[i % sampleAnswers.length]])));

  const base = Date.parse("2025-02-01T10:00:00.000Z");
  const sessionsSpec = [
    { state: "completed", mins: 14 },
    { state: "completed", mins: 11 },
    { state: "in_progress", mins: 0 },
    { state: "abandoned", mins: 3 },
  ];

  let firstCompleted = "";
  for (let i = 0; i < sessionsSpec.length; i++) {
    const spec = sessionsSpec[i];
    const startedAt = new Date(base + i * 3600_000).toISOString();
    const endedAt = spec.mins > 0 ? new Date(base + i * 3600_000 + spec.mins * 60_000).toISOString() : undefined;
    const ses = await db.createDocument(DB, "interview_sessions", ID.unique(), {
      surveyId,
      linkId: "seed-link",
      state: spec.state,
      livekitRoom: `room-seed-${i}`,
      collectedAnswers: spec.state === "in_progress" ? "{}" : answersFor(),
      startedAt,
      ...(endedAt ? { endedAt } : {}),
    });
    if (spec.state === "completed" && !firstCompleted) firstCompleted = ses.$id;
    console.log(`seeded session ${ses.$id} (${spec.state})`);
  }

  // One transcript for the first completed session.
  const segments = [
    { speaker: "interviewer", startMs: 0, endMs: 4000, text: "先聊聊,你找住处时常用哪些网站或 App?" },
    { speaker: "respondent", startMs: 4000, endMs: 12000, text: "我一般先看 Airbnb,再看 Booking 比价,有时也看 Hotels。" },
    { speaker: "interviewer", startMs: 12000, endMs: 16000, text: "订住宿时最让你抓狂的是什么?" },
    { speaker: "respondent", startMs: 16000, endMs: 26000, text: "结账时价格忽然跳涨最崩溃,还有那种为看全价被迫注册的。" },
  ];
  const tr = await db.createDocument(DB, "transcripts", ID.unique(), {
    sessionId: firstCompleted,
    segments: JSON.stringify(segments),
    language: "中文",
    finalizedAt: new Date(base + 14 * 60_000).toISOString(),
  });
  console.log(`seeded transcript ${tr.$id} for session ${firstCompleted}`);
  console.log("seed-sessions done");
}
main().catch((e) => { console.error(e); process.exit(1); });
