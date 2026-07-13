import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { loadDotEnv } from "../packages/appwrite-schema/src/client.js";
import {
  checkHttpReadiness,
  formatReadinessSummary,
  localReadinessTargets,
  waitForReadiness,
  validateLocalDevEnvironment,
  type ReadinessResult,
} from "./dev-orchestrator-core.js";
import { checkFunctionDeployments, localProcessDefinitions, type LocalProcessDefinition } from "./dev-runtime.js";

const root = process.cwd();
const startupTimeoutMs = 90_000;

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

function portIsAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
}

async function assertApplicationPortsAreAvailable(): Promise<void> {
  const ports = [3000, 4111, 8082];
  const unavailable = (await Promise.all(ports.map(async (port) => ({ port, available: await portIsAvailable(port) }))))
    .filter((entry) => !entry.available)
    .map((entry) => entry.port);
  if (unavailable.length > 0) {
    throw new Error(`Cannot start dev:up because these managed ports are already in use: ${unavailable.join(", ")}. Run pnpm dev:status, then stop the existing process or choose one startup owner.`);
  }
}

type RunningProcess = {
  definition: LocalProcessDefinition;
  child: ChildProcess;
  exitReason: () => string | undefined;
};

function startProcess(definition: LocalProcessDefinition): RunningProcess {
  const child = spawn(definition.command, definition.args, {
    cwd: definition.cwd,
    env: { ...process.env, ...definition.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let reason: string | undefined;
  child.once("exit", (code, signal) => {
    reason = `process exited with ${signal ?? `code ${code ?? "unknown"}`}`;
  });
  child.once("error", (error) => {
    reason = `process failed to start: ${error.message}`;
  });
  child.stdout?.on("data", (data: Buffer) => process.stdout.write(`[${definition.component}] ${data}`));
  child.stderr?.on("data", (data: Buffer) => process.stderr.write(`[${definition.component}] ${data}`));
  return { definition, child, exitReason: () => reason };
}

function stopProcesses(processes: RunningProcess[]): void {
  for (const process of processes) {
    if (!process.child.killed && process.exitReason() === undefined) process.child.kill("SIGTERM");
  }
}

async function waitForTarget(component: string, stopReason: () => string | undefined): Promise<ReadinessResult> {
  const target = localReadinessTargets().find((candidate) => candidate.component === component);
  if (!target) throw new Error(`No readiness target registered for ${component}`);
  return waitForReadiness(
    () => checkHttpReadiness(target.component, target.url),
    { timeoutMs: startupTimeoutMs, intervalMs: 1_000, stopReason },
  );
}

function waitForShutdown(processes: RunningProcess[]): Promise<number> {
  return new Promise((resolveShutdown) => {
    let settled = false;
    const finish = (code: number, message: string) => {
      if (settled) return;
      settled = true;
      console.log(message);
      stopProcesses(processes);
      resolveShutdown(code);
    };
    process.once("SIGINT", () => finish(0, "Stopping managed development processes..."));
    process.once("SIGTERM", () => finish(0, "Stopping managed development processes..."));
    for (const running of processes) {
      running.child.once("exit", (code, signal) => {
        finish(1, `${running.definition.component} stopped unexpectedly (${signal ?? `code ${code ?? "unknown"}`}).`);
      });
    }
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  const configurationFailures = validateLocalDevEnvironment(process.env);
  if (configurationFailures.length > 0) {
    throw new Error(["Local development configuration failed:", ...configurationFailures.map((failure) => `- ${failure}`)].join("\n"));
  }

  await assertApplicationPortsAreAvailable();
  await run("bash", ["scripts/check-env.sh"]);
  await run("bash", ["scripts/stack-up.sh"]);

  for (const component of ["Appwrite", "LiveKit"]) {
    const result = await waitForTarget(component, () => undefined);
    if (!result.ok) throw new Error(formatReadinessSummary([result]));
  }

  await run("pnpm", ["schema:apply"]);
  const functionResults = await checkFunctionDeployments(process.env);
  if (functionResults.some((result) => !result.ok)) throw new Error(formatReadinessSummary(functionResults));

  const processes: RunningProcess[] = [];
  try {
    for (const definition of localProcessDefinitions(root)) {
      const running = startProcess(definition);
      processes.push(running);
      const result = await waitForTarget(definition.component, running.exitReason);
      if (!result.ok) throw new Error(formatReadinessSummary([result]));
      console.log(`${definition.component} ready.`);
    }

    console.log("All development services are ready. Press Ctrl-C to stop Web, Mastra, and voice worker; Docker stays running.");
    process.exitCode = await waitForShutdown(processes);
  } catch (error) {
    stopProcesses(processes);
    throw error;
  }
}

if (process.argv[1]?.endsWith("dev-up.ts")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "dev:up failed");
    process.exitCode = 1;
  });
}

export { main as devUp };
