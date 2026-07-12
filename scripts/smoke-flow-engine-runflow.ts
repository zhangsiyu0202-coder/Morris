/**
 * Full runFlow loop smoke with real LLM (hybrid host).
 *
 * Runs the flow-engine graph traversal end-to-end against real DashScope
 * Qwen, using a scripted host for the interviewee-answer side (no LiveKit
 * stack required) but real `agent.generate()` for condition eval + probe
 * generation + probe judge. This covers what unit tests + the LLM-only
 * smoke can't: full step dispatch + edge follow + state updates + branch
 * routing decisions coming out of the real model.
 *
 * Ports HANDOFF.md § P5 4 scenarios to TS. Not a CI test (real API calls).
 *
 * Run:
 *   set -a && source .env && set +a
 *   pnpm tsx scripts/smoke-flow-engine-runflow.ts
 */

import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  ConditionStep,
  FlowEdge,
  FlowStep,
  InterviewFlowConfig,
  ProbeStep,
  QuestionStep,
} from "@merism/contracts";

import {
  buildConditionPrompt,
  buildJudgePrompt,
  buildProbeGenerationPrompt,
  initialFlowState,
  parseYesNo,
  runFlow,
  runProbeLoop,
  stepAnswer,
  type AnswerRecord,
  type FlowEngineHost,
  type FlowState,
  type HostContext,
  type ProbeRunResult,
  type QuestionRunResult,
} from "../apps/agent-voice-worker/src/interview/flow-engine/index";

// ---------------------------------------------------------------------------
// Setup — real LLM Mastra Agent
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
const provider = createOpenAI({ apiKey, baseURL });
const agent = new Agent({
  id: "smoke-runflow",
  name: "Runflow Smoke Agent",
  instructions: "你是一个访谈助理的 LLM 内核。你只回答用户的具体 prompt 指令,不添加解释。",
  model: provider(modelName),
});

async function generate(prompt: string): Promise<string | null> {
  try {
    const out = await agent.generate(prompt);
    return (out.text ?? "").trim();
  } catch {
    return null; // nosemgrep: no-silent-catch-fallback -- smoke script fail-shut mirrors production host
  }
}

// ---------------------------------------------------------------------------
// Hybrid host — scripted `askQuestion`, real LLM `evaluateCondition` / probe
// ---------------------------------------------------------------------------

class HybridSmokeHost implements FlowEngineHost {
  readonly stepEnters: string[] = [];
  readonly conditionCalls: Array<{ condition: string; matched: boolean; raw: string | null }> = [];
  readonly probeRunLog: Array<{ stepId: string; rounds: number }> = [];
  readonly flowCompletedRef = { called: false };

  #answers: Record<string, QuestionRunResult>;
  #probeAnswers: string[];

  constructor(args: {
    /** Scripted answer for each QuestionStep, by stepId. */
    answers: Record<string, QuestionRunResult>;
    /** Answers to feed into probe `askAndWait` in order. */
    probeAnswers?: string[];
  }) {
    this.#answers = args.answers;
    this.#probeAnswers = [...(args.probeAnswers ?? [])];
  }

  async askQuestion(step: QuestionStep, _ctx: HostContext): Promise<QuestionRunResult> {
    const ans = this.#answers[step.stepId];
    if (!ans) throw new Error(`HybridSmokeHost: no scripted answer for step ${step.stepId}`);
    return ans;
  }

  async runProbe(step: ProbeStep, ctx: HostContext): Promise<ProbeRunResult> {
    const state = ctx.state as FlowState;
    const mainAnswer = stepAnswer(state, step.forQuestionStepId);
    if (mainAnswer === null) {
      this.probeRunLog.push({ stepId: step.stepId, rounds: 0 });
      return { rounds: [] };
    }
    const rounds = await runProbeLoop(
      step,
      {
        generateProbe: async (existing) => {
          const prompt = buildProbeGenerationPrompt({
            probeInstruction: step.instruction,
            mainQuestionContent: mainAnswer.questionContent,
            mainAnswer: mainAnswer.respondentAnswer,
            rounds: existing,
          });
          const text = await generate(prompt);
          return text?.trim() ?? "(probe question)";
        },
        askAndWait: async () => this.#probeAnswers.shift() ?? "(no scripted probe answer)",
        judgeSatisfied: async (existing) => {
          const prompt = buildJudgePrompt({
            probeInstruction: step.instruction,
            mainQuestionContent: mainAnswer.questionContent,
            mainAnswer: mainAnswer.respondentAnswer,
            rounds: existing,
          });
          const text = await generate(prompt);
          if (text === null) return true;
          return parseYesNo(text, { defaultBias: true });
        },
      },
      // no logger — keep smoke output focused on branch decisions
    );
    this.probeRunLog.push({ stepId: step.stepId, rounds: rounds.length });
    return { rounds };
  }

  async evaluateCondition(condition: string, sourceAnswer: AnswerRecord, _ctx: HostContext): Promise<boolean> {
    const prompt = buildConditionPrompt(condition, sourceAnswer);
    const text = await generate(prompt);
    const matched = text === null ? false : parseYesNo(text, { defaultBias: false });
    this.conditionCalls.push({ condition, matched, raw: text });
    return matched;
  }

  async onStepEnter(stepId: string, _ctx: HostContext): Promise<void> {
    this.stepEnters.push(stepId);
  }

  async onFlowCompleted(_ctx: HostContext): Promise<void> {
    this.flowCompletedRef.called = true;
  }
}

// ---------------------------------------------------------------------------
// The scenario flow config (branch-e2e shape, one flow instance)
// ---------------------------------------------------------------------------

function q(stepId: string, content: string, out: string | null): QuestionStep {
  return { stepId, kind: "question", outgoingEdgeId: out, questionType: "open_text", content, options: [] };
}

function probe(stepId: string, forQ: string, instruction: string, out: string | null, maxRounds = 2): ProbeStep {
  return { stepId, kind: "probe", outgoingEdgeId: out, forQuestionStepId: forQ, instruction, level: "standard", maxRounds };
}

function cond(
  stepId: string,
  items: Array<{ itemId: string; sourceStepId: string; condition: string; outgoingEdgeId: string | null }>,
  defaultEdge: string | null,
): ConditionStep {
  return {
    stepId,
    kind: "condition",
    outgoingEdgeId: defaultEdge,
    items: items.map((it) => ({
      itemId: it.itemId,
      predicate: { sourceStepId: it.sourceStepId, condition: it.condition },
      outgoingEdgeId: it.outgoingEdgeId,
    })),
  };
}

function edge(id: string, from: string, to: string): FlowEdge {
  return { id, from: { stepId: from }, to: { stepId: to } };
}

function buildFlow(): InterviewFlowConfig {
  const steps: FlowStep[] = [
    q("q_s1", "你现在的主要身份是什么?", "e_s1_c1"),
    cond(
      "c1",
      [
        { itemId: "i1", sourceStepId: "q_s1", condition: "用户是全职学生", outgoingEdgeId: "e_c1_qA" },
        { itemId: "i2", sourceStepId: "q_s1", condition: "用户在工作或创业", outgoingEdgeId: "e_c1_qB" },
      ],
      "e_c1_qD",
    ),
    q("q_A_student", "作为学生,你最近的一个学习困扰是什么?", null),
    q("q_B_worker", "作为职场人,你最近工作里最耗时间的事情是什么?", "e_qB_pB"),
    probe(
      "p_B_worker",
      "q_B_worker",
      "了解职场人耗时事项的具体细节和他们的期望改进方向",
      null,
      2,
    ),
    q("q_D_default", "那可以聊聊你现在最想解决的一个问题吗?", null),
  ];
  const edges: FlowEdge[] = [
    edge("e_s1_c1", "q_s1", "c1"),
    edge("e_c1_qA", "c1", "q_A_student"),
    edge("e_c1_qB", "c1", "q_B_worker"),
    edge("e_c1_qD", "c1", "q_D_default"),
    edge("e_qB_pB", "q_B_worker", "p_B_worker"),
  ];
  return {
    surveyId: "smoke-surv-1",
    sessionId: "smoke-sess-1",
    moderatorInstruction: "你是一个亲切、专业的访谈员,面向早期用户做半结构化访谈。语气温和,不做评判。",
    startStepId: "q_s1",
    steps,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  answers: Record<string, QuestionRunResult>;
  probeAnswers?: string[];
  expectedPath: string[];
  expectedProbeRounds?: number;
}

const scenarios: Scenario[] = [
  {
    name: "student_branch — first rule YES → q_A_student, no second call",
    answers: {
      q_s1: { respondentAnswer: "我在读研究生,是全职学生", selectedOptionIds: [] },
      q_A_student: { respondentAnswer: "毕业论文进度慢", selectedOptionIds: [] },
    },
    expectedPath: ["q_s1", "c1", "q_A_student"],
  },
  {
    name: "worker_branch — first NO, second YES → q_B_worker → probe",
    answers: {
      q_s1: { respondentAnswer: "我在字节跳动做后端,已经工作三年了", selectedOptionIds: [] },
      q_B_worker: { respondentAnswer: "开会太多,尤其是每周有 3 场跨部门会", selectedOptionIds: [] },
    },
    probeAnswers: [
      "特别是跨部门对齐会,每次都要花大量时间准备背景材料,而且开完了没决议",
      "希望有个共享的决议记录工具,大家开会前就能看到上下文,不用每次都重讲背景",
    ],
    expectedPath: ["q_s1", "c1", "q_B_worker", "p_B_worker"],
    expectedProbeRounds: 2,
  },
  {
    name: "fallthrough_branch — both NO → default edge to q_D_default",
    answers: {
      q_s1: { respondentAnswer: "我不太确定,现在有点迷茫,还在找方向", selectedOptionIds: [] },
      q_D_default: { respondentAnswer: "想搞清楚自己适合什么", selectedOptionIds: [] },
    },
    expectedPath: ["q_s1", "c1", "q_D_default"],
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.substring(0, n) + "…";
}

(async () => {
  console.log("=".repeat(72));
  console.log("Flow Engine runFlow REAL-LLM Smoke");
  console.log(`base=${baseURL}, model=${modelName}`);
  console.log("=".repeat(72));

  let pass = 0;
  for (const s of scenarios) {
    console.log(`\n--- ${s.name} ---`);
    const host = new HybridSmokeHost({ answers: s.answers, probeAnswers: s.probeAnswers });
    const state = initialFlowState(buildFlow());
    const start = Date.now();
    await runFlow(state, host);
    const ms = Date.now() - start;

    const path = state.visitedStepIds;
    const pathOk = JSON.stringify(path) === JSON.stringify(s.expectedPath);
    console.log(`  path:     ${path.join(" → ")}`);
    console.log(`  expected: ${s.expectedPath.join(" → ")}`);
    console.log(`  duration: ${ms}ms | condition calls: ${host.conditionCalls.length} | probe runs: ${host.probeRunLog.length}`);
    for (const c of host.conditionCalls) {
      console.log(`    cond: "${c.condition}" → LLM raw="${truncate(c.raw ?? "(null)", 40)}" matched=${c.matched}`);
    }
    for (const p of host.probeRunLog) {
      console.log(`    probe ${p.stepId}: ${p.rounds} round(s)`);
    }

    let scenarioOk = pathOk;
    if (s.expectedProbeRounds != null) {
      const gotRounds = host.probeRunLog[0]?.rounds ?? 0;
      const roundsOk = gotRounds === s.expectedProbeRounds;
      console.log(`  probe rounds: got ${gotRounds}, expected ${s.expectedProbeRounds} ${roundsOk ? "✅" : "❌"}`);
      scenarioOk = scenarioOk && roundsOk;
    }
    if (!host.flowCompletedRef.called) scenarioOk = false;

    console.log(`  ${scenarioOk ? "✅ PASS" : "❌ FAIL"}`);
    if (scenarioOk) pass++;
  }

  console.log("\n" + "=".repeat(72));
  console.log(`OVERALL: ${pass}/${scenarios.length}`);
  console.log("=".repeat(72));
  process.exit(pass === scenarios.length ? 0 : 1);
})().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
