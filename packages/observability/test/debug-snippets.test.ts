import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { extractDebugSnippets, DEBUG_SNIPPET_MAX_CHARS } from "../src/debug-snippets.js";

const ENV_KEY = "MERISM_DEBUG_PROVIDERS";
const original = process.env[ENV_KEY];

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe("K-LLMOBS-09: MERISM_DEBUG_PROVIDERS three states", () => {
  it("env unset → returns undefined", () => {
    expect(extractDebugSnippets({ prompt: "x", completion: "y" })).toBeUndefined();
  });

  it.each(["0", "true", "yes", "TRUE", "", " 1 "])(
    'env "%s" (non-strict "1") → returns undefined',
    (v) => {
      process.env[ENV_KEY] = v;
      expect(extractDebugSnippets({ prompt: "x" })).toBeUndefined();
    },
  );

  it('env "1" → extracts truncated snippets', () => {
    process.env[ENV_KEY] = "1";
    const out = extractDebugSnippets({ prompt: "abc", completion: "xyz" });
    expect(out).toEqual({ promptHead: "abc", completionHead: "xyz" });
  });

  it('env "1" with empty input → returns undefined', () => {
    process.env[ENV_KEY] = "1";
    expect(extractDebugSnippets({})).toBeUndefined();
    expect(extractDebugSnippets({ prompt: "", completion: "" })).toBeUndefined();
  });

  it('env "1" truncates to DEBUG_SNIPPET_MAX_CHARS chars', () => {
    process.env[ENV_KEY] = "1";
    const long = "x".repeat(500);
    const out = extractDebugSnippets({ prompt: long, completion: long });
    expect(out?.promptHead).toHaveLength(DEBUG_SNIPPET_MAX_CHARS);
    expect(out?.completionHead).toHaveLength(DEBUG_SNIPPET_MAX_CHARS);
  });

  it('env "1" with only prompt → no completion key', () => {
    process.env[ENV_KEY] = "1";
    const out = extractDebugSnippets({ prompt: "only" });
    expect(out).toEqual({ promptHead: "only" });
    expect("completionHead" in (out ?? {})).toBe(false);
  });
});
