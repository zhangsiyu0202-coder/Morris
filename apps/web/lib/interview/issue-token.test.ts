import { afterEach, describe, expect, it, vi } from "vitest"

import { issueLivekitToken, summarizeExecutionResponse } from "./issue-token"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("summarizeExecutionResponse", () => {
  it("keeps token-bearing execution bodies out of diagnostic fields", () => {
    const responseBody = '{"token":"token-payload-that-must-not-be-logged"}'
    const summary = summarizeExecutionResponse({
      status: "completed",
      responseStatusCode: 200,
      responseBody,
    })

    expect(summary).toEqual({
      status: "completed",
      httpStatus: 200,
      bodyChars: responseBody.length,
    })
    expect(Object.values(summary).join(" ")).not.toContain("token-payload")
  })

  it("uses the local route in a browser before loading the Appwrite SDK path", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubGlobal("window", {})
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: "session-1",
        livekitUrl: "ws://localhost:7880",
        token: "short-lived-token",
        surveyMeta: { surveyId: "survey-1", title: "Test survey" },
        linkKind: "test",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(issueLivekitToken("link-token", "tester")).resolves.toMatchObject({
      sessionId: "session-1",
      linkKind: "test",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dev-issue-token",
      expect.objectContaining({ method: "POST" }),
    )
  })
})
