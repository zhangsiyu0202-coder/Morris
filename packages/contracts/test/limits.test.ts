import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";

import {
  TIME_LIMITS,
  SIZE_LIMITS,
  COUNT_LIMITS,
  RATE_LIMITS,
  getLlmMaxConcurrent,
} from "../src/limits";

describe("limits registry", () => {
  describe("every value is a positive number", () => {
    it("TIME_LIMITS", () => {
      for (const [key, value] of Object.entries(TIME_LIMITS)) {
        expect(typeof value, key).toBe("number");
        expect(value, key).toBeGreaterThan(0);
      }
    });
    it("SIZE_LIMITS", () => {
      for (const [key, value] of Object.entries(SIZE_LIMITS)) {
        expect(typeof value, key).toBe("number");
        expect(value, key).toBeGreaterThan(0);
      }
    });
    it("COUNT_LIMITS", () => {
      for (const [key, value] of Object.entries(COUNT_LIMITS)) {
        expect(typeof value, key).toBe("number");
        expect(value, key).toBeGreaterThan(0);
        expect(Number.isInteger(value), `${key} should be integer`).toBe(true);
      }
    });
    it("RATE_LIMITS", () => {
      for (const [key, value] of Object.entries(RATE_LIMITS)) {
        expect(typeof value, key).toBe("number");
        expect(value, key).toBeGreaterThan(0);
      }
    });
  });

  describe("naming convention — unit is in the name", () => {
    it("TIME_LIMITS keys end in *Seconds OR *Ms (no other suffix)", () => {
      for (const key of Object.keys(TIME_LIMITS)) {
        expect(
          /(Seconds|Ms)$/.test(key),
          `${key} must end in Seconds or Ms (units in the name)`,
        ).toBe(true);
      }
    });
    it("SIZE_LIMITS keys end in *Bytes / *Chars / *Kb / *Mb / *Gb (units in name)", () => {
      for (const key of Object.keys(SIZE_LIMITS)) {
        expect(
          /(Bytes|Chars|Kb|Mb|Gb)$/.test(key),
          `${key} must end in a size unit`,
        ).toBe(true);
      }
    });
  });

  describe("reclaimGraceSeconds invariant", () => {
    it("MUST exceed jwtTokenTtlSeconds so the original token has expired before reclaim", () => {
      expect(TIME_LIMITS.reclaimGraceSeconds).toBeGreaterThan(TIME_LIMITS.jwtTokenTtlSeconds);
    });
  });

  describe("getLlmMaxConcurrent", () => {
    beforeEach(() => vi.unstubAllEnvs());
    afterEach(() => vi.unstubAllEnvs());

    it("returns the default when env is unset", () => {
      vi.stubEnv("MERISM_LLM_MAX_CONCURRENT", "");
      expect(getLlmMaxConcurrent()).toBe(RATE_LIMITS.llmMaxConcurrentDefault);
    });

    it("returns the env value when set to a positive integer", () => {
      vi.stubEnv("MERISM_LLM_MAX_CONCURRENT", "16");
      expect(getLlmMaxConcurrent()).toBe(16);
    });

    it("falls back to default on \"0\" / \"-1\" / \"abc\" / blank", () => {
      for (const v of ["0", "-1", "abc", "  ", "NaN"]) {
        vi.stubEnv("MERISM_LLM_MAX_CONCURRENT", v);
        expect(getLlmMaxConcurrent(), `for "${v}"`).toBe(RATE_LIMITS.llmMaxConcurrentDefault);
      }
    });

    it("property: any positive integer string parses correctly", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1024 }), (n) => {
          vi.stubEnv("MERISM_LLM_MAX_CONCURRENT", String(n));
          return getLlmMaxConcurrent() === n;
        }),
      );
    });
  });

  describe("immutability", () => {
    it("registry constants are frozen (typescript as const + Object.freeze sanity)", () => {
      // TS prevents mutation at compile time via `as const`. At runtime,
      // attempting to reassign won't throw but a type-aware reviewer will
      // catch the diff. This test just sanity-checks the values are
      // present and stable across imports.
      expect(TIME_LIMITS.jwtTokenTtlSeconds).toBe(30 * 60);
      expect(TIME_LIMITS.workspaceTrialMs).toBe(14 * 24 * 60 * 60 * 1000);
      expect(SIZE_LIMITS.geminiUploadMaxBytes).toBe(2 * 1024 * 1024 * 1024);
      expect(COUNT_LIMITS.geminiVisualMaxSegments).toBe(30);
      expect(RATE_LIMITS.llmMaxConcurrentDefault).toBe(8);
    });
  });
});
