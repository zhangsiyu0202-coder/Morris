/**
 * ADR-0015 W5a advisory migration.
 *
 * Default mode is read-only. Pass `--apply` only after reviewing its dry-run
 * report; the operation is idempotent because it updates blank instructions
 * only and never touches the legacy source fields in this release.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   pnpm exec tsx scripts/backfill-survey-instruction.ts
 *   pnpm exec tsx scripts/backfill-survey-instruction.ts --apply
 */

import { Client, Databases, Query } from "node-appwrite";
import { composeInstructionFromLegacy } from "@merism/contracts";

const DATABASE_ID = "merism";
const SURVEYS = "surveys";
const PAGE_SIZE = 100;

type SurveyDocument = {
  $id: string;
  instruction?: unknown;
  moderatorInstruction?: unknown;
  flowConfig?: unknown;
};

export type BackfillDecision =
  | { kind: "update"; surveyId: string; data: { instruction: string } }
  | { kind: "skip-populated"; surveyId: string }
  | { kind: "unresolved"; surveyId: string };

function parseFlowConfig(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Pure decision seam for W5a tests; it never mutates `flowConfig`. */
export function buildSurveyInstructionBackfillUpdate(
  survey: SurveyDocument,
): BackfillDecision {
  const surveyId = survey.$id;
  if (typeof survey.instruction === "string" && survey.instruction.trim().length > 0) {
    return { kind: "skip-populated", surveyId };
  }

  const flow = parseFlowConfig(survey.flowConfig);
  const instruction = composeInstructionFromLegacy({
    researchGoal: stringValue(flow.researchGoal),
    targetAudience: stringValue(flow.targetAudience),
    introScript: stringValue(flow.introScript),
    moderatorInstruction: stringValue(survey.moderatorInstruction),
  });
  if (!instruction) return { kind: "unresolved", surveyId };

  return { kind: "update", surveyId, data: { instruction } };
}

export function parseBackfillApplyMode(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--apply") return true;
  throw new Error("Usage: backfill-survey-instruction.ts [--apply]");
}

export function buildBackfillQueries(cursor?: string): string[] {
  return [
    Query.orderAsc("$id"),
    Query.limit(PAGE_SIZE),
    ...(cursor ? [Query.cursorAfter(cursor)] : []),
  ];
}

function databaseFromEnv(): Databases {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const project = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !project || !apiKey) {
    throw new Error("Missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY");
  }
  return new Databases(new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey));
}

async function main(): Promise<void> {
  const apply = parseBackfillApplyMode(process.argv.slice(2));
  const database = databaseFromEnv();
  const counts = { scanned: 0, updates: 0, populated: 0, unresolved: 0 };
  let cursor: string | undefined;

  for (;;) {
    const page = await database.listDocuments<SurveyDocument>(
      DATABASE_ID,
      SURVEYS,
      buildBackfillQueries(cursor),
    );
    if (page.documents.length === 0) break;

    for (const survey of page.documents) {
      counts.scanned += 1;
      const decision = buildSurveyInstructionBackfillUpdate(survey);
      if (decision.kind === "skip-populated") {
        counts.populated += 1;
      } else if (decision.kind === "unresolved") {
        counts.unresolved += 1;
        console.warn(`unresolved survey: ${decision.surveyId}`);
      } else {
        counts.updates += 1;
        if (apply) {
          await database.updateDocument(DATABASE_ID, SURVEYS, decision.surveyId, {
            ...decision.data,
            updatedAt: new Date().toISOString(),
          });
        }
        console.log(`${apply ? "updated" : "would update"} survey: ${decision.surveyId}`);
      }
    }

    cursor = page.documents.at(-1)?.$id;
    if (page.documents.length < PAGE_SIZE) break;
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...counts }));
  if (counts.unresolved > 0) process.exitCode = 2;
}

if (process.argv[1]?.endsWith("backfill-survey-instruction.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
