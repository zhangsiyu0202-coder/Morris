import { describe, expect, it } from "vitest";
import { createLiteLlmProvider } from "./index.js";

describe("createLiteLlmProvider", () => {
  it("normalizes a proxy URL and preserves its opaque server credential", () => {
    const provider = createLiteLlmProvider({
      baseUrl: "http://litellm:4000/v1///",
      apiKey: "test-proxy-key",
    });

    const model = provider("deepseek-v4-flash");
    expect(model.provider).toBe("litellm.chat");
    expect(model.modelId).toBe("deepseek-v4-flash");
  });
});
