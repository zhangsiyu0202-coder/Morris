import { describe, it, expect } from "vitest";
import { generateShortId, isValidShortId } from "../short-id";

describe("notebooks: short-id", () => {
  it("generateShortId returns a 12-char lowercase alphanumeric string", () => {
    const id = generateShortId();
    expect(id).toMatch(/^[a-z0-9]{12}$/);
    expect(id).toHaveLength(12);
  });

  it("generateShortId produces no collisions across 1000 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateShortId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(1000);
  });

  it("isValidShortId accepts generated ids and rejects malformed inputs", () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidShortId(generateShortId())).toBe(true);
    }
    // Malformed
    expect(isValidShortId("")).toBe(false);
    expect(isValidShortId("ABC123")).toBe(false); // uppercase
    expect(isValidShortId("abcdefghijk")).toBe(false); // 11 chars
    expect(isValidShortId("abcdefghijklm")).toBe(false); // 13 chars
    expect(isValidShortId("abcdefghijk!")).toBe(false); // special char
    expect(isValidShortId("abc def ghij")).toBe(false); // space
    expect(isValidShortId(null)).toBe(false);
    expect(isValidShortId(undefined)).toBe(false);
    expect(isValidShortId(123)).toBe(false);
  });
});
