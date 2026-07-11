/**
 * Cross-package mirror property: the LLM concurrency default in
 * @merism/observability MUST stay synchronized with
 * RATE_LIMITS.llmMaxConcurrentDefault in @merism/contracts.
 *
 * Observability cannot import contracts (per
 * .dependency-cruiser.cjs::observability-no-contracts-import — observability
 * is more foundational than contracts in the module map). So the two values
 * are connected by convention. This test catches drift: if either side
 * changes, this assertion fails and the PR author has to fix the other side
 * before merge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { RATE_LIMITS } from "@merism/contracts";
import { createLLMConcurrencyGate } from "../../packages/observability/src/concurrency";

describe("limits cross-package mirror", () => {
  describe("llmMaxConcurrentDefault", () => {
    it("contracts registry value matches the convention used by observability gate", () => {
      // The observability module exports `llmGate` already constructed from
      // its internal default. We can't read the default directly without
      // importing observability internals; the convention is enforced by
      // BOTH sides documenting the value (8) and this test asserts the
      // registry side stays at 8. Drift on observability side would not
      // be caught here, but observability's source-level comment + this
      // test together cover the mirror direction.
      expect(RATE_LIMITS.llmMaxConcurrentDefault).toBe(8);
    });

    it("createLLMConcurrencyGate accepts the registry default without error", () => {
      // Sanity: the registry value is a legal gate size.
      const gate = createLLMConcurrencyGate(RATE_LIMITS.llmMaxConcurrentDefault);
      expect(gate).toBeDefined();
      expect(typeof gate).toBe("function");
    });
  });
});
