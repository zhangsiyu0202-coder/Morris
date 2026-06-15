// Local harness: invoke apps/functions/analyzeSurvey against a real Appwrite +
// DeepSeek using a surveyId from argv.
// Usage: pnpm tsx scripts/run-analyze-survey.mts <surveyId>

import { analyzeSurvey } from "../apps/functions/analyzeSurvey/src/handler.js";
import { createRealDeps } from "../apps/functions/analyzeSurvey/src/deps.js";

const surveyId = process.argv[2];
if (!surveyId) {
  console.error("usage: pnpm tsx scripts/run-analyze-survey.mts <surveyId>");
  process.exit(2);
}

const result = await analyzeSurvey({ surveyId }, createRealDeps());
console.log(JSON.stringify({ status: result.status, body: result.body }, null, 2));
process.exit(result.status === 200 ? 0 : 1);
