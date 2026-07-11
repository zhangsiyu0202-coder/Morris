import { describe, it, expect, beforeEach } from "vitest";

import { classifyMorrisError } from "../../../../lib/assistant/errors";
import { morrisErrorCounter, getCounts, resetCounts } from "../../../../lib/assistant/metrics";
import { PageContextSchema } from "../../../../lib/assistant/page-context";

/**
 * 路由层 onError 管线 (T31).
 *
 * 不直接拉起 createAgentUIStreamResponse 与 DeepSeek (那需要 cookies/网络),
 * 而是端到端校验路由内被调用的纯函数管线:
 *   classifyMorrisError(err) -> userMessage + counter.inc + 服务端 detail
 *
 * 这等价于 route.ts 中 onError 回调的行为契约。
 */

beforeEach(() => {
  resetCounts();
});

describe("[assistant] onError pipeline (DeepSeek 401 sample)", () => {
  it("returns the api userMessage and increments api counter", () => {
    const e = Object.assign(new Error("invalid api key"), { status: 401 });
    const m = classifyMorrisError(e);
    morrisErrorCounter.inc(m.kind);
    expect(m.kind).toBe("api");
    expect(m.userMessage).not.toContain("invalid api key");
    expect(m.userMessage).toContain("鉴权");
    expect(getCounts().api).toBe(1);
  });
});

describe("[assistant] onError pipeline (DeepSeek 429 sample)", () => {
  it("returns the transient userMessage and increments transient counter", () => {
    const e = Object.assign(new Error("rate limit"), { status: 429 });
    const m = classifyMorrisError(e);
    morrisErrorCounter.inc(m.kind);
    expect(m.kind).toBe("transient");
    expect(m.userMessage).toContain("稍后");
    expect(getCounts().transient).toBe(1);
  });
});

describe("[assistant] PageContextSchema gate (T11)", () => {
  it("safeParse fails on undeclared field", () => {
    const r = PageContextSchema.safeParse({ surveyId: "abc", secret: "x" });
    expect(r.success).toBe(false);
  });

  it("safeParse passes on legitimate body", () => {
    const r = PageContextSchema.safeParse({
      path: "/studies/abc/guide",
      surveyId: "abc",
      recentSessionIds: ["s1", "s2"],
    });
    expect(r.success).toBe(true);
  });

  it("the userMessage never echoes raw stack/api key fragments", () => {
    const e = new Error("Bearer sk-abcdef stack at fakeFrame");
    e.stack = "at fakeFrame:1:1";
    const m = classifyMorrisError(e);
    expect(m.userMessage).not.toContain("sk-abcdef");
    expect(m.userMessage).not.toContain("at fakeFrame");
  });
});
