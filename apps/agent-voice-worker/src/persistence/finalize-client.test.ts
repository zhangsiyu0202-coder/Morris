import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizeInterviewSession } from "./finalize-client.js";

const log = {
  traceId: "session-1",
  sessionId: "session-1",
  surveyId: "survey-1",
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("finalizeInterviewSession", () => {
  it("uses the standard Appwrite execution API without MERISM_FINALIZE_FUNCTION_URL or KEY", async () => {
    vi.stubEnv("APPWRITE_ENDPOINT", "http://localhost:8080/v1");
    vi.stubEnv("APPWRITE_PROJECT_ID", "merism");
    vi.stubEnv("APPWRITE_API_KEY", "server-key");
    vi.stubEnv("MERISM_FINALIZE_FUNCTION_URL", "");
    vi.stubEnv("MERISM_FINALIZE_FUNCTION_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        responseStatusCode: 200,
        responseBody: JSON.stringify({
          ok: true,
          sessionId: "session-1",
          terminalStatus: "abandoned",
          transcriptPersisted: false,
          analysisTriggered: false,
        }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      finalizeInterviewSession({
        sessionId: "session-1",
        surveyId: "survey-1",
        terminalStatus: "abandoned",
        collectedAnswers: {},
        log,
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/functions/finalizeInterviewSession/executions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Appwrite-Project": "merism",
          "X-Appwrite-Key": "server-key",
        }),
      }),
    );
  });

  it("forwards collected final transcript segments through the Function boundary", async () => {
    vi.stubEnv("APPWRITE_ENDPOINT", "http://localhost:8080/v1");
    vi.stubEnv("APPWRITE_PROJECT_ID", "merism");
    vi.stubEnv("APPWRITE_API_KEY", "server-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        responseStatusCode: 200,
        responseBody: JSON.stringify({
          ok: true,
          sessionId: "session-1",
          terminalStatus: "completed",
          transcriptPersisted: true,
          analysisTriggered: true,
        }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await finalizeInterviewSession({
      sessionId: "session-1",
      surveyId: "survey-1",
      terminalStatus: "completed",
      collectedAnswers: {},
      transcript: {
        language: "zh",
        segments: [{ speaker: "interviewee", startMs: 100, endMs: 100, text: "你好" }],
      },
      log,
    });

    const request = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(JSON.parse(request.body).body)).toMatchObject({
      transcript: {
        language: "zh",
        segments: [{ speaker: "interviewee", startMs: 100, endMs: 100, text: "你好" }],
      },
    });
  });
});
