/**
 * Deterministic scorer: schema match + keyword presence/absence.
 *
 * Reads four fields from the scenario's `expected`:
 *
 *   must_match_schema:           string  — registry name, e.g. "SurveyDraftSchema"
 *   schema_path:                 string  — optional dot-path; navigate `output` before schema check
 *                                          (e.g. "draft" if output is `{kind, draft}`)
 *   must_contain_keywords:       string[] — output must contain ALL of these (case-insensitive)
 *   must_not_mention_keywords:   string[] — output must contain NONE of these (case-insensitive)
 *
 * Any of the four may be omitted; the scorer enforces only what's
 * present. Scorer is fully deterministic — same (input, output, expected)
 * always produces the same result. Token cost: zero.
 *
 * See `.kiro/specs/ai-eval-suite/design.md` § Q1 for why this exists
 * (deterministic rubric covers the first cut; judge model is sub-PR 3).
 */
import { resolveSchema } from "./schemaRegistry";
import type { Scorer, ScoringResult } from "./_types";
import { ZERO_TOKENS } from "./_types";

interface JsonShapeExpected {
  must_match_schema?: string;
  schema_path?: string;
  must_contain_keywords?: readonly string[];
  must_not_mention_keywords?: readonly string[];
}

const NOT_PROVIDED = Symbol("not-provided");

/** Navigate `obj` by dot-path. Returns null if any segment is missing or non-indexable. */
function selectByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return null;
  }
  return cur;
}

export const jsonShapeMatchScorer: Scorer<unknown, unknown, JsonShapeExpected> = {
  name: "json-shape-match",
  async score(_input, output, expected): Promise<ScoringResult> {
    // 1. Schema check.
    if (typeof expected.must_match_schema === "string") {
      const schema = resolveSchema(expected.must_match_schema);
      if (!schema) {
        return {
          ok: false,
          reason: `unknown schema name "${expected.must_match_schema}" (not in registry)`,
          tokens: ZERO_TOKENS,
        };
      }
      const target = expected.schema_path
        ? selectByPath(output, expected.schema_path)
        : output;
      if (target === null && expected.schema_path) {
        return {
          ok: false,
          reason: `schema_path "${expected.schema_path}" did not resolve in output`,
          tokens: ZERO_TOKENS,
        };
      }
      const parsed = schema.safeParse(target);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .slice(0, 3)
          .join("; ");
        return {
          ok: false,
          reason: `schema mismatch (${expected.must_match_schema}${
            expected.schema_path ? ` at ${expected.schema_path}` : ""
          }): ${issues}`,
          tokens: ZERO_TOKENS,
        };
      }
    }

    // 2. Keyword presence.
    const haystack = typeof output === "string" ? output : JSON.stringify(output);
    const haystackLower = haystack.toLowerCase();

    if (Array.isArray(expected.must_contain_keywords)) {
      const missing = expected.must_contain_keywords.filter(
        (kw) => !haystackLower.includes(kw.toLowerCase()),
      );
      if (missing.length > 0) {
        return {
          ok: false,
          reason: `must_contain_keywords missing: ${missing.join(", ")}`,
          tokens: ZERO_TOKENS,
        };
      }
    }

    // 3. Keyword absence.
    if (Array.isArray(expected.must_not_mention_keywords)) {
      const found = expected.must_not_mention_keywords.filter((kw) =>
        haystackLower.includes(kw.toLowerCase()),
      );
      if (found.length > 0) {
        return {
          ok: false,
          reason: `must_not_mention_keywords appeared: ${found.join(", ")}`,
          tokens: ZERO_TOKENS,
        };
      }
    }

    return { ok: true, tokens: ZERO_TOKENS };
  },
};

// Re-export the test-only NOT_PROVIDED sentinel for completeness; harmless if unused.
export { NOT_PROVIDED };
