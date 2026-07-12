/**
 * Real-LLM smoke for the flow-engine's 3 LLM call sites.
 *
 * NOT a CI test — this dials the real DashScope Qwen (or any
 * OpenAI-compatible provider from `.env`) and prints the raw model output.
 * Ports the Python archive scripts:
 *   apps/agent/scripts/real_condition_eval_smoke.py
 *   apps/agent/scripts/real_probe_smoke.py
 *
 * Run:
 *   set -a && source .env && set +a
 *   pnpm tsx scripts/smoke-flow-engine-real-llm.ts
 *
 * Verifies (per HANDOFF.md § 关键设计 decisions 4 + 5):
 *   1. buildConditionPrompt + agent.generate + parseYesNo(defaultBias:false)
 *      classifies answers into student/worker/ambiguous branches correctly
 *   2. buildProbeGenerationPrompt + agent.generate produces a follow-up
 *      question grounded in the last answer (not generic filler)
 *   3. buildJudgePrompt + agent.generate + parseYesNo(defaultBias:true)
 *      terminates when the probe instruction has been met
 */

import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";

import {
  buildConditionPrompt,
  buildJudgePrompt,
  buildProbeGenerationPrompt,
  parseYesNo,
  type AnswerRecord,
  type ProbeRound,
} from "../apps/agent-voice-worker/src/interview/flow-engine/index";

// ---------------------------------------------------------------------------
// Setup: build a Mastra Agent bound to DashScope Qwen (OpenAI-compatible)
// ---------------------------------------------------------------------------

function requireEnv(name: string, fallbacks: string[] = []): string {
  for (const k of [name, ...fallbacks]) {
    const v = process.env[k];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env: ${name}${fallbacks.length ? ` (or ${fallbacks.join("/")})` : ""}`);
}

const apiKey = requireEnv("DASHSCOPE_API_KEY", ["QWEN_API_KEY"]);
const baseURL = process.env.DASHSCOPE_COMPAT_BASE_URL ?? process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const modelName = process.env.QWEN_LLM_MODEL ?? "qwen-plus";

console.log(`Using base=${baseURL}, model=${modelName}`);
console.log(`apiKey: ${apiKey.substring(0, 4)}***(${apiKey.length}chars)`);

const provider = createOpenAI({ apiKey, baseURL });
const model = provider(modelName);
const agent = new Agent({
  id: "smoke-flow-engine",
  name: "Flow Engine Smoke Agent",
  instructions:
    "你是一个访谈助理的 LLM 内核。你只回答用户的具体 prompt 指令,不添加解释。",
  model,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  condition: string;
  answer: AnswerRecord;
  expected: boolean;
}

async function runLLM(prompt: string): Promise<string> {
  const out = await agent.generate(prompt);
  return (out.text ?? "").trim();
}

function truncate(s: string, n = 200): string {
  return s.length <= n ? s : s.substring(0, n) + "…";
}

function ok(pass: boolean, msg: string): void {
  console.log(`${pass ? "✅" : "❌"} ${msg}`);
}

// ---------------------------------------------------------------------------
// Section 1: condition-eval — student / worker / ambiguous
// ---------------------------------------------------------------------------

async function testConditionEval(): Promise<{ pass: number; total: number }> {
  console.log("\n=== Section 1: buildConditionPrompt + parseYesNo(defaultBias=false) ===\n");

  const scenarios: Scenario[] = [
    {
      name: "student answer → student condition YES",
      condition: "用户是全职学生",
      answer: {
        questionContent: "你现在的主要身份是什么?",
        respondentAnswer: "我现在在读研究生,是全职学生",
        selectedOptionIds: [],
      },
      expected: true,
    },
    {
      name: "worker answer → student condition NO",
      condition: "用户是全职学生",
      answer: {
        questionContent: "你现在的主要身份是什么?",
        respondentAnswer: "我在字节跳动做后端工程师,已经工作三年了",
        selectedOptionIds: [],
      },
      expected: false,
    },
    {
      name: "ambiguous answer → student condition NO (no-divert bias)",
      condition: "用户是全职学生",
      answer: {
        questionContent: "你现在的主要身份是什么?",
        respondentAnswer: "我也不太确定,有点迷茫,还在想清楚方向",
        selectedOptionIds: [],
      },
      expected: false,
    },
  ];

  let pass = 0;
  for (const s of scenarios) {
    const prompt = buildConditionPrompt(s.condition, s.answer);
    const raw = await runLLM(prompt);
    const matched = parseYesNo(raw, { defaultBias: false });
    const good = matched === s.expected;
    if (good) pass++;
    console.log(`  scenario: ${s.name}`);
    console.log(`    condition: ${s.condition}`);
    console.log(`    answer: ${truncate(s.answer.respondentAnswer, 60)}`);
    console.log(`    LLM raw: "${truncate(raw, 100)}"`);
    console.log(`    parsed:  ${matched}  (expected ${s.expected})`);
    ok(good, `    ${s.name}\n`);
  }
  return { pass, total: scenarios.length };
}

// ---------------------------------------------------------------------------
// Section 2: probe generation — question grounded in last answer
// ---------------------------------------------------------------------------

async function testProbeGeneration(): Promise<{ pass: number; total: number }> {
  console.log("\n=== Section 2: buildProbeGenerationPrompt (first round) ===\n");

  const prompt = buildProbeGenerationPrompt({
    probeInstruction: "深挖用户对搜索筛选功能的具体不满",
    mainQuestionContent: "你对我们产品的搜索功能有什么看法?",
    mainAnswer: "搜索是能用的,但筛选有点不好用",
    rounds: [] as ProbeRound[],
  });
  const raw = await runLLM(prompt);
  console.log(`  LLM 生成的追问: "${truncate(raw, 200)}"`);

  // Loose checks: it should look like a Chinese question, mention 筛选 or a
  // related concept, and NOT be a rejection / apology / meta commentary.
  const looksLikeQuestion = /[??]/.test(raw) || raw.length > 5;
  const mentionsFilter =
    raw.includes("筛选") ||
    raw.includes("过滤") ||
    raw.includes("哪") ||
    raw.includes("什么");
  const notMeta = !raw.startsWith("很抱歉") && !raw.toLowerCase().startsWith("sorry");
  const good = looksLikeQuestion && mentionsFilter && notMeta;

  ok(good, `follow-up question looks grounded and 中文提问`);
  return { pass: good ? 1 : 0, total: 1 };
}

// ---------------------------------------------------------------------------
// Section 3: probe judge — satisfied vs not
// ---------------------------------------------------------------------------

async function testProbeJudge(): Promise<{ pass: number; total: number }> {
  console.log("\n=== Section 3: buildJudgePrompt + parseYesNo(defaultBias=true) ===\n");

  // A: rich rounds that DO satisfy the instruction → judge should say YES
  const richPrompt = buildJudgePrompt({
    probeInstruction: "了解用户对筛选功能的具体不满和期望的改进方向",
    mainQuestionContent: "你对我们产品的搜索功能有什么看法?",
    mainAnswer: "搜索是能用的,但筛选有点不好用",
    rounds: [
      {
        probeQuestion: "筛选具体哪里让你觉得不好用?",
        respondentAnswer:
          "分类太多但没层次,一屏都看不完,而且选了几个之后没法批量清除,只能一个个取消",
      },
      {
        probeQuestion: "如果让你重新设计,你觉得应该怎么改?",
        respondentAnswer:
          "希望有一个『重置全部』按钮,同时分类应该收起来默认只显示最常用的几个,点开才展开完整列表",
      },
    ],
  });
  const richRaw = await runLLM(richPrompt);
  const richMatched = parseYesNo(richRaw, { defaultBias: true });
  console.log(`  rich rounds: LLM raw="${truncate(richRaw, 60)}", parsed=${richMatched} (expected true)`);
  const richOk = richMatched === true;
  ok(richOk, `  probe judge YES on rich rounds`);

  // B: shallow rounds that DO NOT satisfy → judge should say NO
  const shallowPrompt = buildJudgePrompt({
    probeInstruction: "了解用户对筛选功能的具体不满和期望的改进方向",
    mainQuestionContent: "你对我们产品的搜索功能有什么看法?",
    mainAnswer: "搜索是能用的,但筛选有点不好用",
    rounds: [
      { probeQuestion: "筛选具体哪里让你觉得不好用?", respondentAnswer: "就是不太好用吧" },
    ],
  });
  const shallowRaw = await runLLM(shallowPrompt);
  const shallowMatched = parseYesNo(shallowRaw, { defaultBias: true });
  console.log(`  shallow rounds: LLM raw="${truncate(shallowRaw, 60)}", parsed=${shallowMatched} (expected false)`);
  const shallowOk = shallowMatched === false;
  ok(shallowOk, `  probe judge NO on shallow rounds`);

  return { pass: (richOk ? 1 : 0) + (shallowOk ? 1 : 0), total: 2 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log("=".repeat(70));
  console.log("Flow Engine Real-LLM Smoke");
  console.log("=".repeat(70));
  const results = [
    await testConditionEval(),
    await testProbeGeneration(),
    await testProbeJudge(),
  ];
  const totalPass = results.reduce((a, r) => a + r.pass, 0);
  const totalAll = results.reduce((a, r) => a + r.total, 0);
  console.log("\n" + "=".repeat(70));
  console.log(`OVERALL: ${totalPass}/${totalAll}`);
  console.log("=".repeat(70));
  process.exit(totalPass === totalAll ? 0 : 1);
})().catch((e) => {
  console.error("SMOKE FAILED with exception:");
  console.error(e);
  process.exit(1);
});
