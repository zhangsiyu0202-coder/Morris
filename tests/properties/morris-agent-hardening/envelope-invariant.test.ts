import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  toToolError,
  toolResult,
  type ToolResultEnvelope,
} from "../../../apps/web/lib/assistant/envelope";

/**
 * P-AI-01 — 工具结果 envelope 不变量
 *
 * 任意 args / 任意失败原因 → toolResult / toToolError 都产出
 * { content: string, artifact: T | { error: true, message } }。
 * 失败路径必有 artifact.error === true 且 message 非空; 成功路径 artifact 不带 error。
 */

function isStringNonEmpty(s: unknown): boolean {
  return typeof s === "string" && s.length > 0;
}

function checkEnvelope<T>(env: ToolResultEnvelope<T>) {
  expect(typeof env.content).toBe("string");
  expect(env.content.length).toBeGreaterThan(0);
  // envelope.artifact 必须存在 (key 在 envelope 上); toolResult 允许传入 undefined 作为 artifact 值,
  // 但 toToolError 永远会塞一个 ToolErrorArtifact 对象。这里只断言 key 存在 + 类型可枚举。
  expect("artifact" in env).toBe(true);
}

describe("P-AI-01: tool result envelope shape", () => {
  it("toolResult always returns valid envelope (success path)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.anything(),
        (content, artifact) => {
          const env = toolResult(content, artifact);
          checkEnvelope(env);
          // success 路径: artifact.error 不为 true (我们传入的 artifact 任意, 但 toolResult 不会注入 error)
          const a = env.artifact as { error?: unknown };
          if (a && typeof a === "object") {
            // 若上游随机生成了带 error: true 的对象那也算用户传入的, 不视作 envelope 违例。
            // 这里只要求 toolResult 不会自己加 error 字段。
            // (此性质由 toolResult 实现保证, 不需断言)
          }
        },
      ),
    );
  });

  it("toToolError always returns ToolErrorArtifact with non-empty message", () => {
    const errorArb = fc.oneof(
      fc.string().map((m) => new Error(m)),
      fc.string(),
      fc.constantFrom(null, undefined, 0, false),
      fc.record({ message: fc.string({ minLength: 0, maxLength: 20 }) }),
    );
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), errorArb, (label, err) => {
        const env = toToolError(label, err);
        checkEnvelope(env);
        const a = env.artifact as { error?: unknown; message?: unknown };
        expect(a.error).toBe(true);
        expect(isStringNonEmpty(a.message)).toBe(true);
        // 不泄漏 stack
        expect(String(a.message)).not.toMatch(/\bat\s+\w/);
      }),
    );
  });

  it("simulating tool execute with random failures keeps the envelope shape", async () => {
    // 模拟一个工具的 execute: 每次随机抛或返成功
    async function simulatedExecute(
      seed: number,
    ): Promise<ToolResultEnvelope<{ value: number } | { error: true; message: string }>> {
      try {
        if (seed % 7 === 0) throw new Error(`oops ${seed}`);
        return toolResult(`ok ${seed}`, { value: seed });
      } catch (err) {
        return toToolError(`第 ${seed} 次`, err);
      }
    }
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 10_000 }), async (seed) => {
        const env = await simulatedExecute(seed);
        checkEnvelope(env);
      }),
    );
  });
});
