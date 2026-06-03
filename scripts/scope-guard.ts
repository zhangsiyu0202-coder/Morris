// Scope guard (Req 9): fail if out-of-scope concepts (teams / sharing /
// comments / billing / subscriptions / quotas / plans / seats / usage-metering)
// appear in product source or schema field names. Tests, specs, docs, and the
// guard itself are not scanned (referencing the words there is not a feature).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { COLLECTIONS } from "../packages/appwrite-schema/src/schema.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["apps", "packages", "infra", "scripts", ".github"];
const SCAN_EXT = new Set([".ts", ".tsx", ".py", ".json", ".yml", ".yaml", ".sh"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "build", ".venv", "coverage"]);

const PATTERNS: RegExp[] = [
  /\bteams?\b/i,
  /\bsharedWith\b/i,
  /\bsharing\b/i,
  /\bcomments?\b/i,
  /\bbilling\b/i,
  /\bsubscriptions?\b/i,
  /\bsubscribe\b/i,
  /\bquota\b/i,
  /\bplans?\b/i,
  /\bseats?\b/i,
  /usage[-_]?meter/i,
  /\bmetering\b/i,
];
// LiveKit grants legitimately use these; neutralize the line if present.
const ALLOW = ["canSubscribe", "canPublish"];
const SKIP_FILE = /(\.(test|spec)\.[tj]sx?|_test\.py|scope-guard\.ts)$/;

const hits: string[] = [];

function scanFile(path: string): void {
  if (SKIP_FILE.test(path) || !SCAN_EXT.has(extname(path))) return;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (ALLOW.some((a) => line.includes(a))) return;
    for (const p of PATTERNS) {
      if (p.test(line)) {
        hits.push(`${path.replace(ROOT + "/", "")}:${i + 1}: ${line.trim()}`);
        break;
      }
    }
  });
}

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else scanFile(full);
  }
}

for (const d of SCAN_DIRS) {
  try {
    walk(join(ROOT, d));
  } catch {
    /* dir may not exist */
  }
}

// Schema field-name check (Req 9.2).
const fieldRe = /team|share|comment|billing|subscrib|quota|plan|seat|usage|meter/i;
for (const c of COLLECTIONS) {
  for (const a of c.attributes) {
    if (fieldRe.test(a.key)) hits.push(`schema: forbidden field ${c.id}.${a.key}`);
  }
}

if (hits.length) {
  console.error("scope-guard FAIL — out-of-scope concepts found:");
  for (const h of hits) console.error("  - " + h);
  process.exit(1);
}
console.log("scope-guard: OK");
