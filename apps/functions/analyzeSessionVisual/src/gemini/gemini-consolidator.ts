// Gemini-powered consolidation for the per-segment video observations.
//
// PostHog keeps upload, offset analysis, and session consolidation on Gemini.
// Keeping that boundary here means a visual-analysis job needs no second-model
// credential after it has been claimed.

import { z } from "zod";
import { VISUAL_ANALYSIS_OUTCOMES, VisualSentimentSignalSchema } from "@merism/contracts";
import { withLLMCall } from "@merism/observability";
import type { GeminiClient } from "./client.js";
import { type Consolidator, type ConsolidatedSummary } from "./consolidate.js";
import {
  VISUAL_CONSOLIDATION_SYSTEM,
  buildConsolidationPrompt,
} from "../prompts/visual-consolidation.js";

const ConsolidatedSummarySchema = z.object({
  summary: z.string().min(1),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  tags: z.array(z.string()).default([]),
  keyMoments: z.array(z.object({
    id: z.string(),
    timestampMs: z.number().int().nonnegative(),
    label: z.string(),
    description: z.string(),
    segmentId: z.string().optional(),
  })).default([]),
  frustrationScore: z.number().min(0).max(1).default(0),
  outcome: z.enum(VISUAL_ANALYSIS_OUTCOMES).default("successful"),
  sentimentSignals: z.array(VisualSentimentSignalSchema).default([]),
  tagsFixed: z.array(z.string()).default([]),
  tagsFreeform: z.array(z.string()).default([]),
  highlighted: z.boolean().default(false),
});

// Kept intentionally flat: Gemini only supports a documented subset of JSON
// Schema, and the Zod parse below remains the semantic source of truth.
const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
    tags: { type: "array", items: { type: "string" } },
    keyMoments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          timestampMs: { type: "integer", minimum: 0 },
          label: { type: "string" },
          description: { type: "string" },
          segmentId: { type: "string" },
        },
        required: ["id", "timestampMs", "label", "description"],
      },
    },
    frustrationScore: { type: "number", minimum: 0, maximum: 1 },
    outcome: { type: "string", enum: [...VISUAL_ANALYSIS_OUTCOMES] },
    sentimentSignals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          signalType: { type: "string" },
          segmentIndex: { type: "integer", minimum: 0 },
          description: { type: "string" },
          intensity: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["signalType", "segmentIndex", "description", "intensity"],
      },
    },
    tagsFixed: { type: "array", items: { type: "string" } },
    tagsFreeform: { type: "array", items: { type: "string" } },
    highlighted: { type: "boolean" },
  },
  required: ["summary", "sentiment", "tags", "keyMoments"],
} as const;

export interface GeminiConsolidatorDeps {
  client: GeminiClient;
  model: string;
  /** Retry malformed / rejected responses; default matches the former path. */
  maxContentAttempts?: number;
  /** Invocation trace propagated from the Function error boundary. */
  traceId?: string;
}

export function createGeminiConsolidator(deps: GeminiConsolidatorDeps): Consolidator {
  const attempts = Math.max(1, Math.floor(deps.maxContentAttempts ?? 3));

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
        const response = await withLLMCall(
          {
            scope: "function.analyzeSessionVisual.consolidate",
            traceId: deps.traceId ?? "visual-analysis-untraced",
            attempt: attempt - 1,
            defaultModel: deps.model,
            provider: "gemini",
          },
          async () => {
            const generated = await deps.client.models.generateContent({
              model: deps.model,
              contents: prompt,
              config: {
                systemInstruction: VISUAL_CONSOLIDATION_SYSTEM,
                responseMimeType: "application/json",
                responseJsonSchema: RESPONSE_JSON_SCHEMA,
              },
            });
            const text = responseText(generated);
            return {
              text,
              usage: usageFromGemini(generated),
              response: { modelId: deps.model },
              consolidated: ConsolidatedSummarySchema.parse(JSON.parse(text)),
            };
          },
        );
        return response.consolidated;
      } catch (error) {
        lastError = error;
        if (attempt >= attempts) break;
        const reason = error instanceof Error ? error.message : String(error);
        prompt = `${basePrompt}\n\n上一次输出无法通过校验, 错误: ${truncate(reason, 200)}\n请严格按上面的 JSON shape 重新输出, 不要附加任何解释。`;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`gemini_consolidation_failed: ${String(lastError)}`);
  };
}

function responseText(response: { text?: string; candidates?: unknown }): string {
  if (typeof response.text === "string" && response.text.trim().length > 0) return response.text;
  const candidates = response.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const text = (candidates?.[0]?.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("gemini consolidation returned no text");
  return text;
}

function usageFromGemini(response: {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}) {
  const usage = response.usageMetadata;
  if (!usage) return undefined;
  return {
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
    cachedInputTokens: usage.cachedContentTokenCount,
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
