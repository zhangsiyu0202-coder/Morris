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

// Collaboration concepts: forbidden EVERYWHERE (ADR 0006 keeps these out).
const PATTERNS: RegExp[] = [
  /\bsharedWith\b/i,
  /\bsharing\b/i,
  /\bcomments?\b/i,
  // notebooks sub-spec Wave F: forbid raw `Insight` to prevent regressions
  // after the Insight → Notebook rename. Whitelisted via ALLOW.
  /\bInsight\b/,
];

// ADR-0006 (workspaces-billing) concepts: now in-scope, but ONLY inside the
// workspaces-billing product surface (EXEMPT_PREFIXES). Forbidden elsewhere so
// no other module grows a parallel tenancy/billing concept.
const ADR0006_PATTERNS: RegExp[] = [
  /\bteams?\b/i,
  /\bbilling\b/i,
  /\bsubscriptions?\b/i,
  /\bsubscribe\b/i,
  /\bquota\b/i,
  /\bplans?\b/i,
  /\bseats?\b/i,
  /usage[-_]?meter/i,
  /\bmetering\b/i,
];
const EXEMPT_PREFIXES = [
  "products/workspaces-billing/",
  "packages/contracts/src/billing.ts",
  "packages/appwrite-schema/src/schema.ts", // billing collections live here; field-name guard below still runs for non-billing collections
  "apps/functions/createWorkspace/",
  "apps/functions/inviteMember/",
  "apps/functions/changePlan/",
  "apps/functions/stripeWebhook/",
  "apps/functions/aggregateWorkspaceUsage/",
  "apps/functions/issueLivekitToken/",
  // ADR-0006 web surface. This repo has no top-level products/ dir; the
  // workspaces-billing UI + data seams live under apps/web. Exempt exactly the
  // billing/members surface so the lifted concepts are allowed here only.
  "apps/web/app/settings/billing/",
  "apps/web/app/settings/members/",
  "apps/web/components/workspace-billing/",
  "apps/web/lib/workspace-billing/",
  "apps/web/lib/mock/workspace-billing.ts",
  // ADR-0006 M2: the session-review surface joins the tenancy surface so a
  // workspace's members can see each other's transcript bookmark annotations
  // (read=team, write=author). These files legitimately reference Appwrite
  // Teams (Role.team(workspaceId)); the field-name guard below still applies.
  "apps/web/lib/auth/workspace.ts",
  "apps/web/lib/actions/bookmarks.ts",
  "apps/web/lib/queries/bookmarks.ts",
  "apps/web/lib/queries/studies.ts", // getStudyForViewer: workspace-member read auth
  // ADR-0006 M2 tenant read-scoping consistency: these carry the tenant-scope
  // primitive / Team document permissions (Role.team(workspaceId)) so every
  // workspace-entity read filters uniformly. The field-name guard below still runs.
  "apps/web/lib/queries/client.ts", // TenantScope + tenantFilter primitive
  "apps/web/lib/actions/survey.ts", // createSurvey: read(team)+write(author) permissions
  "apps/web/app/studies/[id]/results/[sessionId]/page.tsx", // viewer auth for shared review
  "scripts/backfill-workspace-tenancy.ts", // ADR-0006 M2 tenancy backfill tool
  "scripts/seed-workspace.ts", // ADR-0006 dev workspace seed
];
const BILLING_COLLECTIONS = new Set([
  "plans", "subscriptions", "usage_events", "usage_counters",
  "workspace_quota", "workspace_memberships", "stripe_events",
]);
// LiveKit grants legitimately use these; neutralize the line if present.
// Morris conversation-compaction module reuses the word "plan" in the hogai
// "plan + apply" sense (CompactionPlan / planCompaction / plan.dropped / plan.keep
// / plan.action). Whitelist those exact tokens so the scope guard does not
// false-positive on the unrelated "subscription plan" sense.
//
// notebooks sub-spec Wave F: also whitelist `\bInsight\b` patterns appearing
// in legitimate AnalysisReport / dashboard contexts that are intentionally
// named with "insight" (the structured analysis output's array of insights,
// not the `Insight` collection that has been renamed to `Notebook`).
const ALLOW = [
  "canSubscribe",
  "canPublish",
  "CompactionPlan",
  "planCompaction",
  "plan.action",
  "plan.dropped",
  "plan.keep",
  "plan + apply",
  "if (plan.",
  "compaction_manager",
  // AnalysisReport embedded insights[] / dashboard widget type
  "top_insights",
  "topInsights",
  "AnalysisReport.insights",
  ".insights",
  "insights:",
  "insights\":",
  "insights[]",
  "insights[number]",
  "insights = ",
  "insights ?? []",
  "insights.length",
  "insights.slice",
  "insights.map",
  "insights.find",
  "insights\"][number]",
  "insightsBlob",
  "fromInsights",
  // The components/report/shared.tsx legacy alias retained for AnalysisReport-embedded
  // insight items (separate semantic from the Notebook collection).
  "type Insight = SurveyAnalysisReportOutput",
  // Pure prose mentions in comments (e.g., "research insight")
  "researcher's insight",
  "research insight",
  "insightful",
  // Historical commit / migration prose mentioning the legacy "Insight" name
  "Insight ↦ Notebook",
  // The components/report alias import: type re-import keeps the AnalysisReport
  // -embedded item alias (kept narrow to this exact line shape).
  "import type { Insight as ReportInsightItem }",
  // shared.tsx narrow alias justification comment line
  "AnalysisReport-internal alias",
  // ADR-0005 visual analysis taxonomy comment intentionally negates teams.
  // The literal "team-custom — teams are out of scope" is a scope-affirming
  // comment, not a feature; allow it past the guard.
  "team-custom",
  "teams are out of scope",
  // ADR 0006: workspaces-billing references in non-exempt files (comments / re-export).
  "./billing.js",
  "workspaces-billing",
  "Appwrite Team id",
  // morris-conversation-persistence borrows PostHog Conversation model shape;
  // the comparison table comment lists rejected PostHog fields.
  "拒绝 22+ 字段",
  "Python mirror, 留 comment",
  // morris-memory borrows PostHog AgentMemory model shape; rejected-fields list.
  "拒绝 6 字段",
  // feedback module comment mentions "team" as the audience for the signal —
  // the word is descriptive prose, not a tenancy concept.
  "the team can hand-eyeball",
];
const SKIP_FILE = /(\.(test|spec)\.[tj]sx?|_test\.py|scope-guard\.ts)$/;

const hits: string[] = [];

function scanFile(path: string): void {
  if (SKIP_FILE.test(path) || !SCAN_EXT.has(extname(path))) return;
  const rel = path.replace(ROOT + "/", "");
  const exempt = EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix));
  const active = exempt ? PATTERNS : [...PATTERNS, ...ADR0006_PATTERNS];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (ALLOW.some((a) => line.includes(a))) return;
    for (const p of active) {
      if (p.test(line)) {
        hits.push(`${rel}:${i + 1}: ${line.trim()}`);
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
  if (BILLING_COLLECTIONS.has(c.id)) continue; // ADR 0006: billing collections may use these field names
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
