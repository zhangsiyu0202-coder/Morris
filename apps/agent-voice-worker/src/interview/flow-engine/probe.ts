/**
 * Probe follow-up sequence + LLM YES/NO judge parsing.
 *
 * Port of `apps/agent/agent/flow_engine/probe.py` per ADR-0013 + the
 * flow-engine-ts-reimpl sub-spec. All wording of built prompts is preserved
 * byte-for-byte from the Python source — the LLM judges are sensitive to
 * exact framing and any change is a behaviour change, not a cleanup.
 *
 * Decision authority split (matches the Python original):
 *   - Continue-or-stop     → this `for` loop + `judgeSatisfied` return
 *   - Round content        → LLM (via injected `generateProbe` callback)
 *   - Satisfaction score   → LLM (via injected `judgeSatisfied` callback,
 *                                  outputs only YES/NO)
 *
 * The LLM never decides "I'm done", "let me ask 2 more", or "let me skip
 * this round". Those are code decisions.
 *
 * NO LiveKit / Mastra imports. Fully unit-testable with plain async
 * callback fakes; the real LLM adapter lives in `livekit-flow-host.ts`.
 */

import type { ProbeStep } from "@merism/contracts";

import type { ProbeRound } from "./types.js";

// ---------------------------------------------------------------------------
// Respondent exhaustion heuristic
// ---------------------------------------------------------------------------

const RESPONDENT_EXHAUSTION_PHRASES = [
  "没有更多",
  "没什么补充",
  "没有补充",
  "就这些",
  "差不多就这些",
  "没了",
  "想不起来",
  "不知道了",
  "nothing else",
  "no more",
  "that's all",
] as const;

/**
 * Narrow stop-signal detector for explicit respondent exhaustion.
 *
 * We only short-circuit when the respondent clearly says they have nothing
 * else to add. Does NOT replace the LLM judge; prevents obviously bad UX
 * where the model keeps probing after a direct "that's all / no more"
 * answer.
 */
export function respondentSignaledNoMore(text: string): boolean {
  const normalized = text.trim().toLowerCase().split(/\s+/).join(" ");
  if (normalized.length === 0) return false;
  return RESPONDENT_EXHAUSTION_PHRASES.some((phrase) => normalized.includes(phrase));
}

// ---------------------------------------------------------------------------
// LLM judge YES/NO parsing
// ---------------------------------------------------------------------------

/**
 * Tolerant parsing of an LLM's YES/NO judge output.
 *
 * The prompt asks for `YES` or `NO` only, but real LLM output drifts:
 *   `YES.` / `Yes, the goal is met` / `是` / `yes\n` / `满足` / etc.
 *
 * Rules (in order — first match wins):
 *   1. Starts with (after strip+upper) `YES`  → `true`
 *   2. Starts with (after strip+upper) `NO`   → `false`
 *   3. Contains ` YES ` as separate token     → `true`
 *   4. Contains ` NO ` as separate token      → `false`
 *   5. Chinese `不` / `没` / `否`             → `false`
 *   6. Chinese `是` / `达` / `满足` / `够`     → `true`
 *   7. Anything else (garbage)                → `defaultBias`
 *
 * The `defaultBias` argument lets callers pick the safe direction on
 * unparseable output:
 *   - probe judge: `true` (STOP probing on garbage — never hammer the
 *     respondent with extra follow-ups just because the LLM's own response
 *     looked confused; the maxRounds cap still bounds runaway probes)
 *   - condition evaluator: `false` (do NOT divert to a branch on garbage
 *     — walk the researcher's default path instead so ambiguous LLM output
 *     can't silently change the interview trajectory)
 */
export function parseYesNo(text: string, opts: { defaultBias: boolean }): boolean {
  const stripped = text.trim().toUpperCase();
  if (stripped.startsWith("YES")) return true;
  if (stripped.startsWith("NO")) return false;
  const padded = ` ${stripped} `;
  if (padded.includes(" YES ") || `\n${stripped}`.includes("\nYES")) return true;
  if (padded.includes(" NO ") || `\n${stripped}`.includes("\nNO")) return false;
  const raw = text.trim();
  if (raw.includes("不") || raw.includes("没") || raw.includes("否")) return false;
  if (
    raw.includes("是") ||
    raw.includes("达") ||
    raw.includes("满足") ||
    raw.includes("够")
  ) {
    return true;
  }
  return opts.defaultBias;
}

// ---------------------------------------------------------------------------
// Prompt composition (byte-preserved from the Python source)
// ---------------------------------------------------------------------------

export interface JudgePromptArgs {
  probeInstruction: string;
  mainQuestionContent: string;
  mainAnswer: string;
  rounds: readonly ProbeRound[];
}

/**
 * Compose the LLM judge prompt per the approved shape (HANDOFF appendix A;
 * confirmed with user 2026-07-09). Changing this wording is a behaviour
 * change — coordinate with the researcher before edits.
 */
export function buildJudgePrompt(args: JudgePromptArgs): string {
  const lines: string[] = [
    `研究员为这个追问写的目标: ${args.probeInstruction}`,
    "",
    `主问题: ${args.mainQuestionContent}`,
    `用户对主问题的回答: ${args.mainAnswer}`,
    "",
    "到目前已经进行的追问:",
  ];
  if (args.rounds.length === 0) {
    lines.push("  (还没有追问过)");
  } else {
    args.rounds.forEach((r, i) => {
      lines.push(`  第 ${i + 1} 轮: 追问="${r.probeQuestion}" 回答="${r.respondentAnswer}"`);
    });
  }
  lines.push(
    "",
    "请判断: 结合以上主答案和已完成的追问, 研究员的追问目标是否已经充分达成?",
    "如果达成, 输出 \"YES\"; 如果还需要继续追问, 输出 \"NO\"。",
    "只输出 YES 或 NO, 不要任何其他文字。",
  );
  return lines.join("\n");
}

export interface ProbeGenerationPromptArgs extends JudgePromptArgs {}

/**
 * Compose the prompt asked to the LLM to generate the NEXT probe question.
 * The generation prompt is intentionally OPEN — it lets the LLM decide the
 * exact wording based on accumulated context. `probeInstruction` is the
 * researcher's directive for what to dig into.
 */
export function buildProbeGenerationPrompt(args: ProbeGenerationPromptArgs): string {
  const lines: string[] = [
    `研究员的追问目标: ${args.probeInstruction}`,
    "",
    `主问题: ${args.mainQuestionContent}`,
    `用户对主问题的回答: ${args.mainAnswer}`,
    "",
  ];
  if (args.rounds.length > 0) {
    lines.push("已经进行的追问:");
    args.rounds.forEach((r, i) => {
      lines.push(`  第 ${i + 1} 轮: 追问="${r.probeQuestion}" 回答="${r.respondentAnswer}"`);
    });
    lines.push("");
    lines.push(
      "请生成下一句追问。要结合用户上一轮回答的具体内容, " +
        "不要泛泛而问, 也不要重复已经问过的角度。只输出这一句追问本身, " +
        "不要任何前后缀。",
    );
  } else {
    lines.push(
      "这是第 1 轮追问。请生成一句自然的追问, 追问用户对主问题的回答。" +
        "结合研究员的追问目标聚焦地问。只输出这一句追问本身, 不要任何前后缀。",
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Probe main loop
// ---------------------------------------------------------------------------

export interface ProbeLoopCallbacks {
  /** Given rounds so far, produce the next probe question text. */
  generateProbe(rounds: readonly ProbeRound[]): Promise<string>;
  /** Given the probe question, speak it and return the respondent's answer. */
  askAndWait(probeQuestion: string): Promise<string>;
  /** Given rounds so far, return whether the researcher instruction is satisfied. */
  judgeSatisfied(rounds: readonly ProbeRound[]): Promise<boolean>;
}

export interface ProbeLoopLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn?(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Execute up to `step.maxRounds` probe rounds, stopping early if the judge
 * says the researcher's `instruction` has been satisfied or the respondent
 * signals no more to add.
 *
 * Empty/whitespace `instruction` means "researcher didn't want to probe
 * here" → skip entirely and return []. The main flow's ProbeStep visit is
 * still recorded, but with zero rounds.
 *
 * `judgeSatisfied` is called at most `(maxRounds - 1)` times: on the final
 * allowed round we skip the judge since maxRounds is already a hard stop
 * and the extra LLM call would be wasted.
 */
export async function runProbeLoop(
  step: ProbeStep,
  callbacks: ProbeLoopCallbacks,
  logger?: ProbeLoopLogger,
): Promise<ProbeRound[]> {
  if (step.instruction.trim().length === 0) {
    logger?.info("probe.skipped.empty_instruction", { stepId: step.stepId });
    return [];
  }

  const rounds: ProbeRound[] = [];
  for (let roundIndex = 0; roundIndex < step.maxRounds; roundIndex++) {
    logger?.info("probe.round.start", {
      stepId: step.stepId,
      roundIndex,
      maxRounds: step.maxRounds,
    });

    const probeQuestion = await callbacks.generateProbe(rounds);
    const answer = await callbacks.askAndWait(probeQuestion);
    rounds.push({ probeQuestion, respondentAnswer: answer });

    if (respondentSignaledNoMore(answer)) {
      logger?.info("probe.round.end.respondent_exhausted", {
        stepId: step.stepId,
        rounds: rounds.length,
      });
      break;
    }

    if (roundIndex + 1 >= step.maxRounds) {
      logger?.info("probe.round.end.hardcap", {
        stepId: step.stepId,
        rounds: rounds.length,
        maxRounds: step.maxRounds,
      });
      break;
    }

    const satisfied = await callbacks.judgeSatisfied(rounds);
    logger?.info("probe.round.end.judged", {
      stepId: step.stepId,
      rounds: rounds.length,
      satisfied,
    });
    if (satisfied) break;
  }

  return rounds;
}
