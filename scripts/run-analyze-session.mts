// Local harness: invoke apps/functions/analyzeSession against a real Appwrite +
// DeepSeek using a sessionId from argv. Avoids needing a deployed Function.
// Usage: pnpm tsx scripts/run-analyze-session.mts <sessionId>

import { analyzeSession } from "../apps/functions/analyzeSession/src/handler.js";
import { createRealDeps } from "../apps/functions/analyzeSession/src/deps.js";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: pnpm tsx scripts/run-analyze-session.mts <sessionId>");
  process.exit(2);
}

const result = await analyzeSession({ sessionId }, createRealDeps());
console.log(JSON.stringify({ status: result.status, body: result.body }, null, 2));
process.exit(result.status === 200 ? 0 : 1);
