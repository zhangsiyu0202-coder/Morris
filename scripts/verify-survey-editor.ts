/**
 * 针对真实本地 Appwrite stack 验证 survey-editor 的写→读→组装往返(P-DATA-01 的
 * live 版)。直接用 node-appwrite 模拟写路径(与 lib/actions/survey.ts 一致),
 * 然后用真实的 assembleSurveyDraft 读回比对。跑完清理。
 *
 * 用法:  set -a && . ./.env && set +a && pnpm exec tsx scripts/verify-survey-editor.ts
 */
import { Client, Databases, ID, Query } from "node-appwrite";
import { assembleSurveyDraft } from "../apps/web/lib/survey-draft.js";
import type { Survey, SurveySection, QuestionBlock, SurveyDraft } from "@merism/contracts";

const DB = "merism";
const OWNER = process.env.MERISM_OWNER_USER_ID || "researcher-dev";

const endpoint = process.env.APPWRITE_ENDPOINT!;
const project = process.env.APPWRITE_PROJECT_ID!;
const apiKey = process.env.APPWRITE_API_KEY!;
if (!endpoint || !project || !apiKey) throw new Error("missing APPWRITE_* env");

const db = new Databases(new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey));

const sample: SurveyDraft = {
  title: "差旅住宿调研(verify)",
  researchGoal: "了解预订习惯",
  targetAudience: "常旅客",
  introScript: "你好,感谢参与",
  sections: [
    {
      title: "暖场",
      objective: "整体习惯",
      questions: [
        { questionText: "常用的订房网站?", questionType: "open_ended", probeLevel: "standard", probeInstruction: "", options: [], allowSkip: false },
        { questionText: "更常用哪个平台?", questionType: "single_choice", probeLevel: "deep", probeInstruction: "追问原因", options: ["Airbnb", "Booking"], allowSkip: true },
      ],
    },
    {
      title: "深入",
      objective: "细节",
      questions: [
        { questionText: "最抓狂的事?", questionType: "open_ended", probeLevel: "standard", probeInstruction: "", options: [], allowSkip: false },
      ],
    },
  ],
};

function parse<T>(v: unknown, fb: T): T {
  if (typeof v !== "string") return (v as T) ?? fb;
  try { return JSON.parse(v) as T; } catch { return fb; }
}

async function main() {
  // --- write (mirrors lib/actions/survey.ts) ---
  const survey = await db.createDocument(DB, "surveys", ID.unique(), {
    ownerUserId: OWNER, projectId: "default", title: sample.title, status: "draft",
    flowConfig: JSON.stringify({ researchGoal: sample.researchGoal, targetAudience: sample.targetAudience, introScript: sample.introScript }),
    version: 1, updatedAt: new Date().toISOString(),
  });
  const surveyId = survey.$id;
  let order = 0;
  for (let si = 0; si < sample.sections.length; si++) {
    const sec = sample.sections[si];
    const sectionDoc = await db.createDocument(DB, "survey_sections", ID.unique(), {
      surveyId, title: sec.title, description: sec.objective, order: si,
    });
    for (let qi = 0; qi < sec.questions.length; qi++) {
      const q = sec.questions[qi];
      await db.createDocument(DB, "question_blocks", ID.unique(), {
        surveyId, sectionId: sectionDoc.$id, order: order++, orderInSection: qi,
        type: q.questionType, prompt: q.questionText,
        config: JSON.stringify({ options: q.options, allowSkip: q.allowSkip }),
        probeConfig: JSON.stringify({ level: q.probeLevel, instruction: q.probeInstruction, maxRounds: q.probeLevel === "deep" ? 5 : 3 }),
        probingPolicy: JSON.stringify({}), skipLogic: JSON.stringify({}),
      });
    }
  }

  // --- read back + assemble ---
  const doc = (await db.getDocument(DB, "surveys", surveyId)) as unknown as Record<string, unknown>;
  const surveyObj: Survey = {
    $id: surveyId, projectId: "default", title: String(doc.title), status: "draft",
    flowConfig: parse<Record<string, unknown>>(doc.flowConfig, {}), version: 1, updatedAt: String(doc.updatedAt),
  };
  const secs = await db.listDocuments(DB, "survey_sections", [Query.equal("surveyId", surveyId), Query.orderAsc("order"), Query.limit(500)]);
  const qs = await db.listDocuments(DB, "question_blocks", [Query.equal("surveyId", surveyId), Query.orderAsc("order"), Query.limit(2000)]);
  const sections = secs.documents.map((d) => ({ $id: d.$id, surveyId, title: (d as Record<string, unknown>).title as string, description: (d as Record<string, unknown>).description as string, order: (d as Record<string, unknown>).order as number })) as SurveySection[];
  const questions = qs.documents.map((d) => { const r = d as unknown as Record<string, unknown>; return { $id: d.$id, surveyId, sectionId: r.sectionId, order: r.order, orderInSection: r.orderInSection, type: r.type, prompt: r.prompt, config: parse(r.config, {}), probeConfig: parse(r.probeConfig, undefined), probingPolicy: {}, skipLogic: {} }; }) as unknown as QuestionBlock[];

  const draft = assembleSurveyDraft(surveyObj, sections, questions);

  // --- assert ---
  const errors: string[] = [];
  if (draft.title !== sample.title) errors.push("title mismatch");
  if (draft.researchGoal !== sample.researchGoal) errors.push("researchGoal mismatch");
  if (draft.introScript !== sample.introScript) errors.push("introScript mismatch");
  if (draft.sections.length !== 2) errors.push(`section count ${draft.sections.length}`);
  if (draft.sections[0]?.questions.length !== 2) errors.push("s0 question count");
  if (draft.sections[0]?.questions[1]?.options.join(",") !== "Airbnb,Booking") errors.push("options mismatch");
  if (draft.sections[0]?.questions[1]?.allowSkip !== true) errors.push("allowSkip mismatch");
  if (draft.sections[0]?.questions[1]?.probeLevel !== "deep") errors.push("probeLevel mismatch");

  // --- cleanup ---
  for (const d of qs.documents) await db.deleteDocument(DB, "question_blocks", d.$id);
  for (const d of secs.documents) await db.deleteDocument(DB, "survey_sections", d.$id);
  await db.deleteDocument(DB, "surveys", surveyId);

  if (errors.length) { console.error("verify-survey-editor FAIL:", errors); process.exit(1); }
  console.log("verify-survey-editor OK (write->read->assemble roundtrip against real Appwrite)");
}

main().catch((e) => { console.error(e); process.exit(1); });
