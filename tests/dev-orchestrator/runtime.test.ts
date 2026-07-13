import { describe, expect, it } from "vitest";

import { localProcessDefinitions } from "../../scripts/dev-runtime";

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
        env: { MASTRA_PORT: "4111" },
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
});
