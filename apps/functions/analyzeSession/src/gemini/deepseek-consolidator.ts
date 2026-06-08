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
import { type Consolidator, type ConsolidatedSummary } from "./consolidate.js";
import {
  VISUAL_CONSOLIDATION_SYSTEM,
  buildConsolidationPrompt,
} from "../prompts/visual-consolidation.js";

// Schema mirrors ConsolidatedSummary; we let the SDK enforce shape on the
// model output so we get predictable JSON.
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
});

export interface DeepSeekConsolidatorDeps {
  /** Pre-built language model (e.g. deepseek("deepseek-chat")). */
  model: LanguageModel;
  /** Cap on retries for the underlying SDK call. Default 1 (PostHog uses similar). */
  maxRetries?: number;
}

export function createDeepSeekConsolidator(deps: DeepSeekConsolidatorDeps): Consolidator {
  const { model, maxRetries = 1 } = deps;

  return async (inputs): Promise<ConsolidatedSummary> => {
    const prompt = buildConsolidationPrompt({
      segments: inputs.segments,
      expectedSegmentCount: inputs.expectedSegmentCount,
      transcriptText: inputs.transcriptText,
    });

    const { experimental_output } = await generateText({
      model,
      maxRetries,
      experimental_output: Output.object({ schema: ConsolidatedSummarySchema }),
      system: VISUAL_CONSOLIDATION_SYSTEM,
      prompt,
    });

    return ConsolidatedSummarySchema.parse(experimental_output);
  };
}
