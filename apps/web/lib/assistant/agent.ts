import { ToolLoopAgent, stepCountIs, type StopCondition } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  buildAssistantTools,
  type AssistantToolContext,
  type AssistantTools,
} from "./tools";
import { SYSTEM_INSTRUCTIONS } from "./system-prompt";

/**
 * Morris researcher assistant — Vercel AI SDK 6 ToolLoopAgent.
 *
 * Per-request factory (`buildMorrisAgent(ctx)`) so each request gets tools
 * scoped to the signed-in researcher's identity. The route handler resolves
 * `ownerUserId` from the Appwrite cookie session and passes it here.
 *
 * LLM is fixed to DeepSeek (deepseek-chat with deepseek-reasoner as a
 * downgrade target on tool errors / late steps). See ADR-0002 for the stack
 * decision.
 */

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

const CHAT_MODEL = deepseek("deepseek-chat");
const REASONING_MODEL = deepseek("deepseek-reasoner");

const budgetExceeded: StopCondition<AssistantTools> = ({ steps }) => {
  const total = steps.reduce(
    (acc, step) => acc + (step.usage?.inputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
    0,
  );
  return total > 24000;
};

function hadToolError(
  steps: ReadonlyArray<{ toolResults?: ReadonlyArray<{ output?: unknown }> }>,
): boolean {
  return steps.some((step) =>
    (step.toolResults ?? []).some((r) => {
      const out = r.output as { error?: boolean } | null | undefined;
      return Boolean(out && typeof out === "object" && out.error === true);
    }),
  );
}

export function buildMorrisAgent(ctx: AssistantToolContext) {
  return new ToolLoopAgent({
    model: CHAT_MODEL,
    instructions: SYSTEM_INSTRUCTIONS,
    tools: buildAssistantTools(ctx),
    stopWhen: [stepCountIs(8), budgetExceeded],
    maxRetries: 2,
    prepareStep: async ({ stepNumber, steps, messages }) => {
      const patch: {
        model?: typeof CHAT_MODEL;
        messages?: typeof messages;
        toolChoice?: "none" | "auto";
      } = {};
      if (messages.length > 24) patch.messages = messages.slice(-16);
      if (hadToolError(steps) || stepNumber >= 5) {
        patch.model = REASONING_MODEL;
        patch.toolChoice = "none";
      }
      return patch;
    },
  });
}
