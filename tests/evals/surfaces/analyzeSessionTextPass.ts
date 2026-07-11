import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  AnalysisReportOutputSchema,
  type AnalysisReportInput,
  type AnalysisReportOutput,
} from "@merism/contracts";

import {
  SESSION_ANALYZE_SYSTEM,
  buildSessionAnalyzeUserPrompt,
} from "../../../apps/functions/analyzeSession/src/prompts/session-analyze";
import type { SurfaceAdapter } from "./_types";

export const analyzeSessionTextPassSurface: SurfaceAdapter<AnalysisReportInput, AnalysisReportOutput> = {
  name: "function.analyzeSession.text-pass",

  async invoke(input) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY not set — eval surface function.analyzeSession.text-pass requires a real provider key',
      );
    }

    const deepseek = createDeepSeek({ apiKey });
    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 1,
      experimental_output: Output.object({ schema: AnalysisReportOutputSchema }),
      system: SESSION_ANALYZE_SYSTEM,
      prompt: buildSessionAnalyzeUserPrompt({
        surveyTitle: input.survey.title,
        questions: input.survey.questionBlocks.map((question) => ({
          questionId: question.$id,
          questionType: question.type,
          prompt: question.prompt,
        })),
        segments: input.transcript.segments.map((segment, segmentIndex) => ({
          transcriptId: input.sessionId,
          segmentIndex,
          speaker: segment.speaker,
          text: segment.text,
        })),
        collectedAnswers: input.collectedAnswers,
      }),
    });

    return AnalysisReportOutputSchema.parse(experimental_output);
  },
};
