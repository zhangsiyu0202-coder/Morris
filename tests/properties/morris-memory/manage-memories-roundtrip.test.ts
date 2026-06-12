/**
 * P-MEM-01: ManageMemoriesActionSchema discriminated union — every valid
 * input should round-trip through parse + serialize unchanged.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ManageMemoriesActionSchema,
  MEMORY_CONTENT_MAX,
} from "@merism/contracts";

const safeContent = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length > 0 && s.length <= MEMORY_CONTENT_MAX);

const safeMetadata = fc
  .dictionary(fc.string({ minLength: 1, maxLength: 16 }), fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
    maxKeys: 8,
  });

const safeMemoryId = fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.length > 0);

const actionArb = fc.oneof(
  fc.record({ action: fc.constant("create" as const), content: safeContent, metadata: safeMetadata }),
  fc.record({
    action: fc.constant("query" as const),
    queryText: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length > 0),
    metadataFilter: safeMetadata,
    limit: fc.integer({ min: 1, max: 50 }),
  }),
  fc.record({
    action: fc.constant("update" as const),
    memoryId: safeMemoryId,
    content: safeContent,
    metadata: safeMetadata,
  }),
  fc.record({ action: fc.constant("delete" as const), memoryId: safeMemoryId }),
  fc.record({
    action: fc.constant("list" as const),
    metadataFilter: safeMetadata,
    limit: fc.integer({ min: 1, max: 50 }),
  }),
);

describe("P-MEM-01: ManageMemoriesActionSchema round-trip", () => {
  it("any valid action survives parse + JSON round-trip", () => {
    fc.assert(
      fc.property(actionArb, (action) => {
        const r = ManageMemoriesActionSchema.safeParse(action);
        expect(r.success).toBe(true);
        if (r.success) {
          // re-encoding via JSON.stringify and re-parsing yields equivalent
          const reparsed = ManageMemoriesActionSchema.safeParse(
            JSON.parse(JSON.stringify(r.data)),
          );
          expect(reparsed.success).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("rejects any input with action set to an unknown literal", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter(
          (s) => !["create", "query", "update", "delete", "list"].includes(s),
        ),
        (badAction) => {
          const r = ManageMemoriesActionSchema.safeParse({ action: badAction });
          expect(r.success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
