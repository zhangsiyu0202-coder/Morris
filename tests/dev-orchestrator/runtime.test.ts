import { describe, expect, it } from "vitest";

import {
  checkFunctionDeployments,
  localProcessDefinitions,
} from "../../scripts/dev-runtime";

describe("local development process definitions", () => {
  it("starts each application on its fixed local port", () => {
    expect(localProcessDefinitions("/repo")).toEqual([
      {
        component: "Web",
        command: "pnpm",
        args: ["-F", "@merism/web", "dev", "--", "--port", "3000"],
        cwd: "/repo",
        env: { NEXT_TELEMETRY_DISABLED: "1" },
      },
      {
        component: "Mastra",
        command: "pnpm",
        args: ["-F", "@merism/agent-voice-worker", "dev"],
        cwd: "/repo",
        env: { PORT: "4111" },
      },
      {
        component: "Voice worker",
        command: "pnpm",
        args: ["-F", "@merism/agent-voice-worker", "dev:worker"],
        cwd: "/repo",
        env: { HEALTH_PORT: "8082" },
      },
    ]);
  });

  it("requires every production-path Function to have a ready deployment", async () => {
    const results = await checkFunctionDeployments(
      {
        APPWRITE_ENDPOINT: "http://localhost:8080/v1",
        APPWRITE_PROJECT_ID: "merism",
        APPWRITE_API_KEY: "not-printed",
      },
      async (url) => new Response(JSON.stringify({
        deployments: url.endsWith("issueLivekitToken/deployments") ? [{ status: "ready" }] : [],
      }), { status: 200 }),
    );

    expect(results).toContainEqual({
      component: "Function: issueLivekitToken",
      ok: true,
      url: "http://localhost:8080/v1/functions/issueLivekitToken/deployments",
    });
    expect(results).toContainEqual({
      component: "Function: finalizeInterviewSession",
      ok: false,
      url: "http://localhost:8080/v1/functions/finalizeInterviewSession/deployments",
      reason: "no ready deployment",
    });
  });
});
