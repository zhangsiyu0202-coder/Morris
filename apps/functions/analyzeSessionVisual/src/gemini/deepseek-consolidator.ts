// DeepSeek-powered consolidator for Gemini's per-segment visual outputs.
//
// Maps the abstract `Consolidator` interface (gemini/consolidate.ts) to
// a concrete DeepSeek call via the existing @ai-sdk/deepseek + ai stack
// already used by the main session analyzer.
//
// Returns ConsolidatedSummary; failures bubble up so the orchestrator can
// trigger the deterministic fallback (gemini-visual-analyzer.ts).

import { z } from "zod";
import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { VISUAL_ANALYSIS_OUTCOMES, VisualSentimentSignalSchema } from "@merism/contracts";
import { type Consolidator, type ConsolidatedSummary } from "./consolidate.js";
import {
  VISUAL_CONSOLIDATION_SYSTEM,
  buildConsolidationPrompt,
} from "../prompts/visual-consolidation.js";

// Schema mirrors ConsolidatedSummary; we let the SDK enforce shape on the
// model output so we get predictable JSON. Sentiment numbers + tags are
// re-clamped/sanitized afterwards by validateAndClampConsolidatedSummary.
const ConsolidatedSummarySchema = z.object({
  summary: z.string().min(1),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  tags: z.array(z.string()).default([]),
  keyMoments: z
    .array(
      z.object({
        id: z.string(),
        timestampMs: z.number().int().nonnegative(),
        label: z.string(),
        description: z.string(),
        segmentId: z.string().optional(),
      }),
    )
    .default([]),
  // Gap D: numeric frustration model.
  frustrationScore: z.number().min(0).max(1).default(0),
  outcome: z.enum(VISUAL_ANALYSIS_OUTCOMES).default("successful"),
  sentimentSignals: z.array(VisualSentimentSignalSchema).default([]),
  // Gap E: fixed-taxonomy + freeform tags + highlight (sanitized in the clamp).
  tagsFixed: z.array(z.string()).default([]),
  tagsFreeform: z.array(z.string()).default([]),
  highlighted: z.boolean().default(false),
});

export interface DeepSeekConsolidatorDeps {
  /** Pre-built language model (e.g. deepseek("deepseek-chat")). */
  model: LanguageModel;
  /** Cap on the SDK's transport-level retries (network/5xx). Default 1. */
  maxRetries?: number;
  /**
   * Cap on CONTENT retries: when the model returns text that fails JSON/schema
   * validation, the parse error is fed back into the prompt and we retry. This
   * is separate from `maxRetries` (which only covers transport). Default 3,
   * mirroring PostHog's a6 consolidation loop. The deterministic fallback in
   * the orchestrator remains the final backstop once these are exhausted.
   */
  maxContentAttempts?: number;
}

export function createDeepSeekConsolidator(deps: DeepSeekConsolidatorDeps): Consolidator {
  const { model, maxRetries = 1, maxContentAttempts = 3 } = deps;
  const attempts = Math.max(1, Math.floor(maxContentAttempts));

  return async (inputs): Promise<ConsolidatedSummary> => {
    const basePrompt = buildConsolidationPrompt({
      segments: inputs.segments,
      expectedSegmentCount: inputs.expectedSegmentCount,
      transcriptText: inputs.transcriptText,
    });

    let prompt = basePrompt;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const { experimental_output } = await generateText({
          model,
          maxRetries,
          experimental_output: Output.object({ schema: ConsolidatedSummarySchema }),
          system: VISUAL_CONSOLIDATION_SYSTEM,
          prompt,
        });
        return ConsolidatedSummarySchema.parse(experimental_output);
      } catch (err) {
        lastError = err;
        if (attempt >= attempts) break;
        const reason = err instanceof Error ? err.message : String(err);
        // Append the parse/validation error and re-ask. Feedback is appended to
        // the user prompt (system prompt unchanged) so the model self-corrects.
        prompt = `${basePrompt}\n\n上一次输出无法通过校验, 错误: ${truncate(reason, 200)}\n请严格按上面的 JSON shape 重新输出, 不要附加任何解释。`;
      }
    }
    // Exhausted content attempts — bubble up so the orchestrator falls back.
    throw lastError instanceof Error
      ? lastError
      : new Error(`deepseek_consolidation_failed: ${String(lastError)}`);
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
