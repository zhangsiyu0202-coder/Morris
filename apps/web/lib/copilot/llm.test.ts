import { describe, it, expect, beforeEach } from "vitest";
import { createCopilotModel } from "./llm";

describe("copilot LLM factory (DeepSeek via OpenAI SDK)", () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_BASE_URL;
  });

  it("defaults to DeepSeek endpoint + model", () => {
    const { baseURL, modelName } = createCopilotModel();
    expect(modelName).toBe("deepseek-v4-flash");
    expect(baseURL).toContain("deepseek");
  });

  it("honors model + baseURL overrides", () => {
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com/beta";
    const { baseURL, modelName } = createCopilotModel();
    expect(modelName).toBe("deepseek-v4-flash");
    expect(baseURL).toBe("https://api.deepseek.com/beta");
  });
});
