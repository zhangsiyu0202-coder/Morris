import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  MIN_DESCRIPTION_CHARS,
  TOOL_TYPES,
  validateToolMetadata,
  type ToolMetadata,
} from "../../../apps/web/lib/assistant/tool-metadata";

/**
 * P-MORRIS-METADATA-01..04: validateToolMetadata 的代数性质 (Wave F T25 / morris-tool-metadata).
 *
 * 不 import 真实 buildAssistantToolMetadata (它链到 server-only @/lib/queries),
 * 而是用 fast-check 生成任意合法的 ToolMetadata 对象, 验证 validateToolMetadata
 * 在各种边界输入下的健壮性。这覆盖 metadata.test.ts 的 fixture-based 测试无法
 * 触达的 ToolMetadata 取值空间。
 */

const annotationsArb = (
  override: Partial<ToolMetadata["annotations"]> = {},
): fc.Arbitrary<ToolMetadata["annotations"]> =>
  fc.record({
    readOnly: override.readOnly !== undefined ? fc.constant(override.readOnly) : fc.boolean(),
    destructive:
      override.destructive !== undefined ? fc.constant(override.destructive) : fc.boolean(),
    idempotent:
      override.idempotent !== undefined ? fc.constant(override.idempotent) : fc.boolean(),
  });

const longDescArb = fc.string({ minLength: MIN_DESCRIPTION_CHARS, maxLength: 2000 });
const titleArb = fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0);
const scopeStringArb = fc.string({ minLength: 1, maxLength: 32 });
const scopesArb = fc.array(scopeStringArb, { maxLength: 8 });

/** 合法的 read 工具 metadata 任意生成器 (满足所有 invariant). */
const validReadArb: fc.Arbitrary<ToolMetadata> = fc.record({
  title: titleArb,
  description: longDescArb,
  annotations: annotationsArb({ readOnly: true, destructive: false }),
  requiredScopes: scopesArb,
  type: fc.constant("read" as const),
  enabled: fc.boolean(),
});

/** 合法的 meta 工具 metadata 任意生成器. */
const validMetaArb: fc.Arbitrary<ToolMetadata> = fc.record({
  title: titleArb,
  description: longDescArb,
  annotations: annotationsArb({ readOnly: true }),
  requiredScopes: fc.constant([] as readonly string[]),
  type: fc.constant("meta" as const),
  enabled: fc.boolean(),
});

describe("P-MORRIS-METADATA-01: validateToolMetadata accepts any well-formed read fixture", () => {
  it("issues are always empty for valid read metadata", () => {
    fc.assert(
      fc.property(validReadArb, (m) => {
        const issues = validateToolMetadata("anyTool", m);
        if (issues.length > 0) {
          throw new Error(`unexpected issues: ${issues.join("; ")}`);
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe("P-MORRIS-METADATA-02: validateToolMetadata accepts any well-formed meta fixture", () => {
  it("issues are always empty for valid meta metadata", () => {
    fc.assert(
      fc.property(validMetaArb, (m) => {
        const issues = validateToolMetadata("anyTool", m);
        if (issues.length > 0) {
          throw new Error(`unexpected issues: ${issues.join("; ")}`);
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe("P-MORRIS-METADATA-03: any description shorter than MIN_DESCRIPTION_CHARS triggers issue", () => {
  it("rejects sub-threshold descriptions", () => {
    fc.assert(
      fc.property(
        validReadArb,
        fc.string({ maxLength: MIN_DESCRIPTION_CHARS - 1 }),
        (base, shortDesc) => {
          const m: ToolMetadata = { ...base, description: shortDesc };
          const issues = validateToolMetadata("anyTool", m);
          // 至少有一个 issue 是关于 description.length 的
          return issues.some((s) => s.includes("description.length="));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("P-MORRIS-METADATA-04: type cast attacks are rejected", () => {
  it("non-TOOL_TYPES type values trigger issue", () => {
    fc.assert(
      fc.property(
        validReadArb,
        fc
          .string({ minLength: 1, maxLength: 32 })
          .filter((s) => !TOOL_TYPES.includes(s as ToolMetadata["type"])),
        (base, badType) => {
          const m = { ...base, type: badType as unknown as ToolMetadata["type"] };
          const issues = validateToolMetadata("anyTool", m);
          return issues.some((s) => s.includes(`type="${badType}"`));
        },
      ),
      { numRuns: 100 },
    );
  });
});
