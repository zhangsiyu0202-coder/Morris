import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  filterNotebookContentForPublishing,
  PUBLISHED_ALLOWLIST,
} from "../../../apps/web/lib/notebooks/filter-for-publishing";
import {
  MERISM_NODE_TYPES,
  type MerismNodeType,
  type ProseMirrorDoc,
  type InlineNode,
} from "../../../apps/web/lib/notebooks/types";

/**
 * P-NB-03 — filter-for-publishing 闭包 + 幂等 + 不动 paragraph/heading.
 *
 * 正确性核心:
 *  1. 闭包: 输出仍是合法 ProseMirrorDoc, 任何 atom node 要么在 allowlist 里
 *     (保留 attrs), 要么是 merism-stripped (无 PII attrs, 只 kind).
 *  2. 幂等: filter(filter(doc)) === filter(doc).
 *  3. paragraph / heading 的非 atom inline (text) 不被改动.
 *  4. 自定义 allowlist 严格遵守 (allowlist 之外的 atom 一定被 strip).
 */

const merismNodeArb = fc.record({
  type: fc.constantFrom(...MERISM_NODE_TYPES) as fc.Arbitrary<MerismNodeType>,
  attrs: fc.record({
    sessionId: fc.string({ minLength: 1, maxLength: 32 }),
    segmentIndex: fc.integer({ min: 0, max: 1000 }),
    quote: fc.string({ minLength: 1, maxLength: 100 }),
  }) as fc.Arbitrary<Record<string, string | number>>,
});

const textNodeArb: fc.Arbitrary<InlineNode> = fc.record({
  type: fc.constant("text" as const),
  text: fc.string({ minLength: 1, maxLength: 50 }),
});

const inlineArb: fc.Arbitrary<InlineNode> = fc.oneof(textNodeArb, merismNodeArb as fc.Arbitrary<InlineNode>);

const blockArb = fc.oneof(
  fc.record({
    type: fc.constant("paragraph" as const),
    content: fc.array(inlineArb, { minLength: 0, maxLength: 6 }),
  }),
  fc.record({
    type: fc.constant("heading" as const),
    attrs: fc.record({ level: fc.constantFrom(1, 2, 3) }) as fc.Arbitrary<{ level: 1 | 2 | 3 }>,
    content: fc.array(textNodeArb, { minLength: 1, maxLength: 4 }),
  }),
  merismNodeArb,
);

const docArb: fc.Arbitrary<ProseMirrorDoc> = fc.record({
  type: fc.constant("doc" as const),
  content: fc.array(blockArb, { minLength: 0, maxLength: 12 }),
}) as fc.Arbitrary<ProseMirrorDoc>;

describe("P-NB-03: filterNotebookContentForPublishing closure + idempotence", () => {
  it("output every atom is either in allowlist OR merism-stripped (no other types)", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const out = filterNotebookContentForPublishing(doc);
        const allKnown = ["doc", "paragraph", "heading", "text", "merism-stripped", ...PUBLISHED_ALLOWLIST];
        const visit = (n: { type: string; content?: unknown[] }) => {
          expect(allKnown).toContain(n.type);
          if (Array.isArray(n.content)) {
            for (const child of n.content) {
              visit(child as { type: string; content?: unknown[] });
            }
          }
        };
        visit(out as unknown as { type: string; content?: unknown[] });
      }),
    );
  });

  it("idempotent: filter(filter(doc)) deeply equals filter(doc)", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const once = filterNotebookContentForPublishing(doc);
        const twice = filterNotebookContentForPublishing(once);
        expect(twice).toEqual(once);
      }),
    );
  });

  it("merism-stripped nodes carry only kind attr (no PII fields)", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const out = filterNotebookContentForPublishing(doc);
        const visit = (n: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
          if (n.type === "merism-stripped") {
            expect(n.attrs).toBeDefined();
            expect(Object.keys(n.attrs!)).toEqual(["kind"]);
          }
          if (Array.isArray(n.content)) {
            for (const child of n.content) {
              visit(child as { type: string; attrs?: Record<string, unknown>; content?: unknown[] });
            }
          }
        };
        visit(out as unknown as { type: string; attrs?: Record<string, unknown>; content?: unknown[] });
      }),
    );
  });

  it("paragraph + heading + text content (non-atom) is preserved verbatim", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const out = filterNotebookContentForPublishing(doc);
        for (let i = 0; i < doc.content.length; i++) {
          const inBlock = doc.content[i]!;
          const outBlock = out.content[i]!;
          if (inBlock.type === "heading" || inBlock.type === "paragraph") {
            // text nodes inside should be byte-identical
            const inTexts = (inBlock.content ?? [])
              .filter((n) => n.type === "text")
              .map((n) => (n as { text: string }).text);
            const outTexts = (outBlock as { content?: InlineNode[] }).content!
              .filter((n) => n.type === "text")
              .map((n) => (n as { text: string }).text);
            expect(outTexts).toEqual(inTexts);
          }
        }
      }),
    );
  });

  it("custom allowlist: only listed atoms preserved", () => {
    fc.assert(
      fc.property(docArb, fc.subarray(MERISM_NODE_TYPES as readonly string[]), (doc, allowlist) => {
        const out = filterNotebookContentForPublishing(doc, allowlist);
        const visit = (n: { type: string; content?: unknown[] }) => {
          if (n.type.startsWith("merism-") && n.type !== "merism-stripped") {
            expect(allowlist).toContain(n.type);
          }
          if (Array.isArray(n.content)) {
            for (const child of n.content) {
              visit(child as { type: string; content?: unknown[] });
            }
          }
        };
        visit(out as unknown as { type: string; content?: unknown[] });
      }),
    );
  });
});
