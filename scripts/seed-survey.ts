/**
 * 给本地 stack 播种几个调研(归属 dev owner),方便 `pnpm -F web dev` 验收。
 * 用法:  set -a && . ./.env && set +a && pnpm exec tsx scripts/seed-survey.ts
 * 幂等性:每次运行都会新增(不去重);仅用于本地演示。
 */
import { Client, Databases, ID } from "node-appwrite";
import type { SurveyDraft } from "@merism/contracts";

const DB = "merism";
const OWNER = process.env.MERISM_OWNER_USER_ID || "researcher-dev";
const db = new Databases(
  new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!),
);

const drafts: SurveyDraft[] = [
  {
    title: "差旅住宿预订习惯调研",
    researchGoal: "了解商旅人群选择住宿平台的决策路径",
    targetAudience: "每月至少出差一次的职场人士",
    introScript: "你好,感谢抽时间参与这次访谈。我们想聊聊你订住宿的习惯。",
    sections: [
      {
        title: "整体预订习惯",
        objective: "了解常用平台与决策因素",
        questions: [
          { questionText: "找住处时,你常用的网站或 App 有哪些?", questionType: "open_ended", probeLevel: "standard", probeInstruction: "确认是否提到具体平台名", options: [], allowSkip: false },
          { questionText: "订住宿时最让你抓狂的是什么?", questionType: "open_ended", probeLevel: "deep", probeInstruction: "追问具体场景与情绪", options: [], allowSkip: false },
          { questionText: "更偏好哪类住宿?", questionType: "single_choice", probeLevel: "standard", probeInstruction: "", options: ["酒店", "民宿", "公寓"], allowSkip: true },
        ],
      },
      {
        title: "Airbnb 任务",
        objective: "观察真实搜索过程",
        questions: [
          { questionText: "假设要去巴黎住一周,演示一下你会怎么搜?", questionType: "open_ended", probeLevel: "deep", probeInstruction: "观察流程,不打断", options: [], allowSkip: false },
          { questionText: "完成这个任务的难易程度?", questionType: "rating", probeLevel: "standard", probeInstruction: "请其解释打分原因", options: [], allowSkip: false },
        ],
      },
    ],
  },
  {
    title: "新用户引导体验访谈",
    researchGoal: "定位新用户首次使用的卡点",
    targetAudience: "近两周注册的新用户",
    introScript: "你好!想请你回顾一下刚开始使用我们产品时的体验。",
    sections: [
      {
        title: "首次印象",
        objective: "捕捉第一步的困惑",
        questions: [
          { questionText: "第一次打开时,你的第一感觉是什么?", questionType: "open_ended", probeLevel: "standard", probeInstruction: "", options: [], allowSkip: false },
        ],
      },
    ],
  },
];

async function seedOne(draft: SurveyDraft) {
  const survey = await db.createDocument(DB, "surveys", ID.unique(), {
    ownerUserId: OWNER,
    projectId: "default",
    title: draft.title,
    status: "draft",
    flowConfig: JSON.stringify({
      researchGoal: draft.researchGoal,
      targetAudience: draft.targetAudience,
      introScript: draft.introScript,
    }),
    version: 1,
    updatedAt: new Date().toISOString(),
  });
  let order = 0;
  for (let si = 0; si < draft.sections.length; si++) {
    const sec = draft.sections[si];
    const sectionDoc = await db.createDocument(DB, "survey_sections", ID.unique(), {
      surveyId: survey.$id,
      title: sec.title,
      description: sec.objective,
      order: si,
    });
    for (let qi = 0; qi < sec.questions.length; qi++) {
      const q = sec.questions[qi];
      await db.createDocument(DB, "question_blocks", ID.unique(), {
        surveyId: survey.$id,
        sectionId: sectionDoc.$id,
        order: order++,
        orderInSection: qi,
        type: q.questionType,
        prompt: q.questionText,
        config: JSON.stringify({ options: q.options, allowSkip: q.allowSkip }),
        probeConfig: JSON.stringify({ level: q.probeLevel, instruction: q.probeInstruction, maxRounds: q.probeLevel === "deep" ? 5 : 3 }),
        probingPolicy: JSON.stringify({}),
        skipLogic: JSON.stringify({}),
      });
    }
  }
  console.log(`seeded survey ${survey.$id} — ${draft.title}`);
}

async function main() {
  for (const d of drafts) await seedOne(d);
  console.log("seed-survey done");
}
main().catch((e) => { console.error(e); process.exit(1); });
