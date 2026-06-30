/**
 * Eval harness report writer.
 *
 * Writes a JSON report to `tests/evals/reports/<iso-timestamp>.json`.
 * Reports are gitignored (the corpus is the durable artifact; reports
 * are run output).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EvalReport } from "./schemas";

export function reportsDirectory(): string {
  return join(process.cwd(), "tests", "evals", "reports");
}

export function writeReport(report: EvalReport, dir = reportsDirectory()): string {
  mkdirSync(dir, { recursive: true });
  // Filesystem-safe timestamp: drop colons.
  const stamp = report.recordedAt.replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}
