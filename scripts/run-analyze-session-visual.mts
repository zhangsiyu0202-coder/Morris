// Local harness: invoke apps/functions/analyzeSessionVisual against real
// Appwrite + Gemini Vision using a sessionId from argv. ADR-0005.
// Usage: pnpm tsx scripts/run-analyze-session-visual.mts <sessionId>

import { analyzeSessionVisual } from "../apps/functions/analyzeSessionVisual/src/handler.js";
import { createRealDeps } from "../apps/functions/analyzeSessionVisual/src/deps.js";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: pnpm tsx scripts/run-analyze-session-visual.mts <sessionId>");
  process.exit(2);
}

const result = await analyzeSessionVisual({ sessionId }, createRealDeps());
console.log(JSON.stringify({ status: result.status, body: result.body }, null, 2));
process.exit(result.status === 200 ? 0 : 1);
