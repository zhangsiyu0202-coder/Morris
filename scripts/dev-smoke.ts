import { spawn } from "node:child_process";

import { loadDotEnv } from "../packages/appwrite-schema/src/client.js";
import {
  checkHttpReadiness,
  formatReadinessSummary,
  localReadinessTargets,
  validateLocalDevEnvironment,
} from "./dev-orchestrator-core.js";
import { checkFunctionDeployments } from "./dev-runtime.js";

const root = process.cwd();

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code ?? "an unknown error"}`));
    });
  });
}

async function verifyDeployedIssueTokenFunction(): Promise<void> {
  const endpoint = process.env.APPWRITE_ENDPOINT?.replace(/\/$/, "");
  const project = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !project || !apiKey) throw new Error("Appwrite function credentials are not configured");

  const response = await fetch(`${endpoint}/functions/issueLivekitToken/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Appwrite-Project": project,
      "X-Appwrite-Key": apiKey,
    },
    body: JSON.stringify({
      body: JSON.stringify({ invalid: true }),
      async: false,
      path: "/",
      method: "POST",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Function execution API returned HTTP ${response.status}`);
  const execution = await response.json() as { status?: unknown; responseStatusCode?: unknown; responseBody?: unknown };
  if (execution.status !== "completed" || execution.responseStatusCode !== 400 || execution.responseBody !== '{"error":"invalid_input"}') {
    throw new Error("issueLivekitToken deployed Function did not reject malformed input as expected");
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const configurationFailures = validateLocalDevEnvironment(process.env);
  if (configurationFailures.length > 0) {
    throw new Error(["Local development configuration failed:", ...configurationFailures.map((failure) => `- ${failure}`)].join("\n"));
  }

  const serviceResults = await Promise.all(localReadinessTargets().map((target) =>
    checkHttpReadiness(target.component, target.url),
  ));
  const functionResults = await checkFunctionDeployments(process.env);
  const readinessResults = [...serviceResults, ...functionResults];
  if (readinessResults.some((result) => !result.ok)) throw new Error(formatReadinessSummary(readinessResults));

  console.log("Smoke 1/3: deployed issueLivekitToken Function execution...");
  await verifyDeployedIssueTokenFunction();
  console.log("Smoke 2/3: Appwrite + LiveKit token issuance core...");
  await run("tsx", ["scripts/smoke.mts"]);
  console.log("Smoke 3/3: dispatched LiveKit worker flow...");
  await run("tsx", ["scripts/smoke-livekit-e2e.ts"]);
  console.log("DEV SMOKE OK — Web, Appwrite, deployed Functions, LiveKit, and Gemini Live voice worker passed.");
}

if (process.argv[1]?.endsWith("dev-smoke.ts")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "dev smoke failed");
    process.exitCode = 1;
  });
}

export { main as devSmoke, verifyDeployedIssueTokenFunction };
