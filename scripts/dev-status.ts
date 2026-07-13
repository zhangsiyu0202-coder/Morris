import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadDotEnv } from "../packages/appwrite-schema/src/client.js";
import {
  checkHttpReadiness,
  formatReadinessSummary,
  localReadinessTargets,
  validateLocalDevEnvironment,
} from "./dev-orchestrator-core.js";
import { checkFunctionDeployments } from "./dev-runtime.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  loadDotEnv();
  const configurationFailures = validateLocalDevEnvironment(process.env);
  if (configurationFailures.length > 0) {
    console.error(["Local development configuration failed:", ...configurationFailures.map((failure) => `- ${failure}`)].join("\n"));
    process.exitCode = 1;
    return;
  }

  const serviceResults = await Promise.all(localReadinessTargets().map((target) =>
    checkHttpReadiness(target.component, target.url),
  ));
  const functionResults = await checkFunctionDeployments(process.env);
  const results = [...serviceResults, ...functionResults];

  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAIL"}  ${result.component}${result.reason ? ` — ${result.reason}` : ""}`);
  }
  if (results.every((result) => result.ok)) return;

  console.error(`\n${formatReadinessSummary(results)}`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "dev status failed");
    process.exitCode = 1;
  });
}

export { main as devStatus };
