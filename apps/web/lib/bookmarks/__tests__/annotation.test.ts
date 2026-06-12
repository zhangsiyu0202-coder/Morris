import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  MAX_BOOKMARK_NOTE_LENGTH,
  MAX_BOOKMARK_TAGS,
  MAX_BOOKMARK_TAG_LENGTH,
  normalizeBookmarkNote,
  normalizeBookmarkTags,
} from "@/lib/bookmarks/annotation";

describe("normalizeBookmarkNote", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeBookmarkNote("  痛点很明显  ")).toBe("痛点很明显");
  });

  it("clamps to the column budget", () => {
    const long = "x".repeat(MAX_BOOKMARK_NOTE_LENGTH + 500);
    expect(normalizeBookmarkNote(long).length).toBe(MAX_BOOKMARK_NOTE_LENGTH);
  });
});

describe("normalizeBookmarkTags", () => {
  it("trims, drops empties, and dedupes preserving first-seen order", () => {
    expect(normalizeBookmarkTags([" 导航 ", "导航", "", "  ", "痛点"])).toEqual(["导航", "痛点"]);
  });

  it("clamps each tag length and caps the count", () => {
    const tooLong = "y".repeat(MAX_BOOKMARK_TAG_LENGTH + 10);
    expect(normalizeBookmarkTags([tooLong])[0].length).toBe(MAX_BOOKMARK_TAG_LENGTH);

    const many = Array.from({ length: MAX_BOOKMARK_TAGS + 5 }, (_, i) => `t${i}`);
    expect(normalizeBookmarkTags(many).length).toBe(MAX_BOOKMARK_TAGS);
  });

  it("always returns within bounds for any input (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (tags) => {
        const out = normalizeBookmarkTags(tags);
        expect(out.length).toBeLessThanOrEqual(MAX_BOOKMARK_TAGS);
        expect(new Set(out).size).toBe(out.length); // no dups
        for (const t of out) {
          expect(t.length).toBeLessThanOrEqual(MAX_BOOKMARK_TAG_LENGTH);
          expect(t).toBe(t.trim());
          expect(t.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});
