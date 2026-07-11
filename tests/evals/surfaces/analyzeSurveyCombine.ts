import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";

import { type CombineThemesInput } from "../../../apps/functions/analyzeSurvey/src/handler";
import {
  ExtractedThemesListSchema,
  type ExtractedThemes,
} from "../../../apps/functions/analyzeSurvey/src/rollup";
import {
  THEME_COMBINATION_SYSTEM,
  buildThemeCombinationUserPrompt,
} from "../../../apps/functions/analyzeSurvey/src/prompts/theme-combination";

import type { SurfaceAdapter } from "./_types";

export const analyzeSurveyCombineSurface: SurfaceAdapter<CombineThemesInput, ExtractedThemes> = {
  name: "function.analyzeSurvey.combine",

  async invoke(input) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY not set — eval surface function.analyzeSurvey.combine requires a real provider key',
      );
    }

    const deepseek = createDeepSeek({ apiKey });
    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 1,
      experimental_output: Output.object({ schema: ExtractedThemesListSchema }),
      system: THEME_COMBINATION_SYSTEM,
      prompt: buildThemeCombinationUserPrompt(input),
    });

    return ExtractedThemesListSchema.parse(experimental_output);
  },
};
