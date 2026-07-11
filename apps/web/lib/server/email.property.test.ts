import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sanitizeHeaderValue } from "./email-core";

describe("email header sanitization properties", () => {
  it("never leaves CR or LF in sanitized header values", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const sanitized = sanitizeHeaderValue(value) ?? "";
        expect(sanitized).not.toContain("\r");
        expect(sanitized).not.toContain("\n");
      }),
    );
  });
});
