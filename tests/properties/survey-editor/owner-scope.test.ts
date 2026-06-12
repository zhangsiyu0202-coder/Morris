import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getStudy, listStudies } from "../../../apps/web/lib/queries/studies";
import { makeFakeDatabases } from "../../../apps/web/lib/queries/__tests__/helpers";
import type { TenantScope } from "../../../apps/web/lib/queries/client";

/**
 * P-SEC-04 + P-SEC-TENANT (ADR-0006): the editor read paths (`getStudy` /
 * `listStudies`) scope every read through `tenantFilter`:
 *   - solo researcher (workspaceId null) → `ownerUserId` scope (legacy);
 *   - workspace member → `workspaceId` scope (ADR-0006 D3 read-shared-within-
 *     workspace). A user in workspace X can NEVER read a row whose
 *     `workspaceId !== X`.
 *
 * The write path (`lib/actions/survey.ts::assertOwned`) applies the matching
 * author predicate; its end-to-end enforcement against live Appwrite Team
 * permissions is covered by the stack-gated integration tests. Here we exhaust
 * the read-scope boundary with in-memory Deps.
 */

type OwnerId = "owner" | "stranger";

function survey(id: string, ownerUserId: OwnerId, workspaceId?: string) {
  return {
    $id: id,
    projectId: "p1",
    title: `S-${id}`,
    status: "draft" as const,
    flowConfig: {},
    version: 1,
    ownerUserId,
    ...(workspaceId ? { workspaceId } : {}),
    updatedAt: "2026-06-11T00:00:00.000Z",
  };
}

const solo = (ownerUserId: OwnerId): TenantScope => ({ ownerUserId, workspaceId: null });

describe("P-SEC-04: solo read scope never crosses ownerUserId", () => {
  it("listStudies returns only the caller's surveys", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 })),
        async ([ownerCount, strangerCount]) => {
          const documents = [
            ...Array.from({ length: ownerCount }, (_, i) => survey(`o-${i}`, "owner")),
            ...Array.from({ length: strangerCount }, (_, i) => survey(`s-${i}`, "stranger")),
          ];
          const { databases } = makeFakeDatabases({ surveys: { documents } });

          const mine = await listStudies(solo("owner"), databases);
          expect(mine).toHaveLength(ownerCount);
          for (const s of mine) expect(s.$id.startsWith("o-")).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("getStudy returns null for a stranger's survey, the survey for the owner", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<OwnerId>("owner", "stranger"), async (docOwner) => {
        const { databases } = makeFakeDatabases({
          surveys: { documents: [survey("sv1", docOwner)] },
          survey_sections: { documents: [] },
          question_blocks: { documents: [] },
        });

        const asOwner = await getStudy(solo("owner"), "sv1", databases);
        if (docOwner === "owner") {
          expect(asOwner?.survey.$id).toBe("sv1");
        } else {
          expect(asOwner).toBeNull();
        }
      }),
      { numRuns: 20 },
    );
  });

  it("neither party can read the other's survey by id", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 })),
        async ([ownerCount, strangerCount]) => {
          const ownerDocs = Array.from({ length: ownerCount }, (_, i) => survey(`o-${i}`, "owner"));
          const strangerDocs = Array.from({ length: strangerCount }, (_, i) =>
            survey(`s-${i}`, "stranger"),
          );
          const { databases } = makeFakeDatabases({
            surveys: { documents: [...ownerDocs, ...strangerDocs] },
            survey_sections: { documents: [] },
            question_blocks: { documents: [] },
          });

          for (const d of strangerDocs) {
            expect(await getStudy(solo("owner"), d.$id, databases)).toBeNull();
          }
          for (const d of ownerDocs) {
            expect(await getStudy(solo("stranger"), d.$id, databases)).toBeNull();
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("P-SEC-TENANT (ADR-0006): workspace read scope never crosses workspaceId", () => {
  it("a workspace-X caller reads only rows whose workspaceId === X", async () => {
    const rowArb = fc.record({
      id: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
      ws: fc.constantFrom("ws_x", "ws_y", "ws_z"),
      owner: fc.constantFrom<OwnerId>("owner", "stranger"),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(rowArb, { maxLength: 20 }), fc.constantFrom("ws_x", "ws_y"), async (rows, callerWs) => {
        // de-dupe ids so the fixture is well-formed
        const seen = new Set<string>();
        const documents = rows
          .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
          .map((r, i) => survey(`row-${i}`, r.owner, r.ws));

        const { databases } = makeFakeDatabases({ surveys: { documents } });
        // caller belongs to workspace `callerWs`; ownerUserId is irrelevant to a
        // workspace-scoped read (D3: any member reads the whole workspace).
        const scope: TenantScope = { ownerUserId: "owner", workspaceId: callerWs };
        const visible = await listStudies(scope, databases);

        const expected = documents.filter((d) => d.workspaceId === callerWs).length;
        expect(visible).toHaveLength(expected);
        for (const s of visible) {
          const row = documents.find((d) => d.$id === s.$id)!;
          expect(row.workspaceId).toBe(callerWs);
        }
      }),
      { numRuns: 40 },
    );
  });
});
