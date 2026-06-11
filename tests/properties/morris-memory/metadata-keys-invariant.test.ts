/**
 * P-MEM-03: metadataKeys === Object.keys(metadata).sort() invariant
 * (enforced at the schema level).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  MorrisMemorySchema,
  MEMORY_METADATA_KEYS_MAX,
} from "@merism/contracts";

const safeMetadata = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 16 }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { maxKeys: MEMORY_METADATA_KEYS_MAX - 1 },
);

const validBase = (metadata: Record<string, unknown>, metadataKeys: string[]) => ({
  $id: "m1",
  ownerUserId: "u1",
  content: "fact",
  metadata: JSON.stringify(metadata),
  metadataKeys,
  embedding: "",
  embeddingModel: "",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
});

describe("P-MEM-03: metadataKeys mirrors Object.keys(metadata)", () => {
  it("any metadata accepts when metadataKeys === sorted Object.keys", () => {
    fc.assert(
      fc.property(safeMetadata, (metadata) => {
        const keys = Object.keys(metadata).sort();
        const r = MorrisMemorySchema.safeParse(validBase(metadata, keys));
        expect(r.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects when metadataKeys claims an extra key not in metadata", () => {
    fc.assert(
      fc.property(
        safeMetadata,
        fc.string({ minLength: 1, maxLength: 16 }),
        (metadata, extraKey) => {
          if (extraKey in metadata) return; // skip overlap
          const keys = [...Object.keys(metadata).sort(), extraKey];
          const r = MorrisMemorySchema.safeParse(validBase(metadata, keys));
          expect(r.success).toBe(false);
          if (!r.success) {
            expect(r.error.issues.some((i) => i.path[0] === "metadataKeys")).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("rejects when metadataKeys is missing a key that's in metadata", () => {
    fc.assert(
      fc.property(safeMetadata, (metadata) => {
        const keys = Object.keys(metadata);
        if (keys.length === 0) return; // skip empty metadata
        const truncated = keys.slice(0, -1).sort(); // drop one
        const r = MorrisMemorySchema.safeParse(validBase(metadata, truncated));
        expect(r.success).toBe(false);
      }),
      { numRuns: 50 },
    );
  });
});
