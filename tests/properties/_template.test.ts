import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * PBT template — copy this into tests/properties/<your-spec>/ when starting a
 * sub-spec. State the correctness property (P-XXX-NN) in the describe title and
 * reference the foundation-setup/design.md §Correctness Properties entry.
 *
 * Convention: arbitraries up top, the invariant inside fc.assert(fc.property(...)).
 */
describe("P-TEMPLATE: example invariant", () => {
  it("array concat length is additive (sample property)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.array(fc.integer()), (a, b) => {
        expect(a.concat(b).length).toBe(a.length + b.length);
      }),
    );
  });
});
