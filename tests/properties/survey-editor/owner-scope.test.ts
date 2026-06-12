import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getStudy, listStudies } from "../../../apps/web/lib/queries/studies";
import { makeFakeDatabases } from "../../../apps/web/lib/queries/__tests__/helpers";

/**
 * P-SEC-04 (survey-editor): 编辑器读写对非 `ownerUserId` 的 survey 一律拒绝/返回空。
 *
 * 编辑器读路径(`getStudy` / `listStudies`)按 `ownerUserId` 作用域过滤。写路径
 * `lib/actions/survey.ts::assertOwned` 应用**完全相同**的所有权谓词
 * (`doc.ownerUserId !== owner → 拒绝`),其针对 live Appwrite 的端到端验证由
 * scripts 的 stack 校验覆盖。这里用内存 Deps 穷举所有权边界:对任意
 * (owner, stranger) 文档集,owner 调用绝不读到 stranger 的 survey,反之亦然。
 */

type OwnerId = "owner" | "stranger";

function survey(id: string, ownerUserId: OwnerId) {
  return {
    $id: id,
    projectId: "p1",
    title: `S-${id}`,
    status: "draft" as const,
    flowConfig: {},
    version: 1,
    ownerUserId,
    updatedAt: "2026-06-11T00:00:00.000Z",
  };
}

describe("P-SEC-04: survey-editor read scope never crosses ownerUserId", () => {
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

          const mine = await listStudies("owner", databases);
          expect(mine).toHaveLength(ownerCount);
          for (const s of mine) expect(s.$id.startsWith("o-")).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("getStudy returns null for a survey owned by a stranger, the survey for the owner", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<OwnerId>("owner", "stranger"), async (docOwner) => {
        const { databases } = makeFakeDatabases({
          surveys: { documents: [survey("sv1", docOwner)] },
          survey_sections: { documents: [] },
          question_blocks: { documents: [] },
        });

        const asOwner = await getStudy("owner", "sv1", databases);
        if (docOwner === "owner") {
          expect(asOwner).not.toBeNull();
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

          // owner cannot read any stranger-owned survey by id
          for (const d of strangerDocs) {
            expect(await getStudy("owner", d.$id, databases)).toBeNull();
          }
          // stranger cannot read any owner-owned survey by id
          for (const d of ownerDocs) {
            expect(await getStudy("stranger", d.$id, databases)).toBeNull();
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
