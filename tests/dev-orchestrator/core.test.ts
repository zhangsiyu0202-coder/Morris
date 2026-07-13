import { describe, expect, it, vi } from "vitest";

import {
  checkHttpReadiness,
  formatReadinessSummary,
  waitForReadiness,
  validateLocalDevEnvironment,
  type ReadinessResult,
} from "../../scripts/dev-orchestrator-core";

const localEnvironment = {
  APPWRITE_ENDPOINT: "http://localhost:8080/v1",
  APP_URL: "http://localhost:3000",
  LIVEKIT_URL: "ws://localhost:7880",
};

describe("local dev orchestration contract", () => {
  it("accepts the documented local endpoints", () => {
    expect(validateLocalDevEnvironment(localEnvironment)).toEqual([]);
  });

  it("rejects endpoint drift with the required value", () => {
    expect(validateLocalDevEnvironment({
      ...localEnvironment,
      APPWRITE_ENDPOINT: "http://localhost:8081/v1",
      LIVEKIT_URL: "wss://staging.example.test",
    })).toEqual([
      "APPWRITE_ENDPOINT must be http://localhost:8080/v1 for dev:up (received http://localhost:8081/v1)",
      "LIVEKIT_URL must be ws://localhost:7880 for dev:up (received wss://staging.example.test)",
    ]);
  });

  it("groups failed readiness checks with actionable causes", () => {
    const results: ReadinessResult[] = [
      { component: "Appwrite", ok: true, url: "http://localhost:8080/v1/health/version" },
      { component: "Web", ok: false, url: "http://localhost:3000/_health/readyz?role=web", reason: "timed out after 30s" },
      { component: "Voice worker", ok: false, url: "http://localhost:8082/_readyz", reason: "connection refused" },
    ];

    expect(formatReadinessSummary(results)).toBe([
      "Readiness failed:",
      "- Web: timed out after 30s (http://localhost:3000/_health/readyz?role=web)",
      "- Voice worker: connection refused (http://localhost:8082/_readyz)",
    ].join("\n"));
  });

  it("treats a non-success HTTP response as not ready instead of accepting an open port", async () => {
    const result = await checkHttpReadiness(
      "Web",
      "http://localhost:3000/_health/readyz?role=web",
      async () => new Response("starting", { status: 503 }),
    );

    expect(result).toEqual({
      component: "Web",
      ok: false,
      url: "http://localhost:3000/_health/readyz?role=web",
      reason: "HTTP 503",
    });
  });

  it("retries a failing health probe until it reports ready", async () => {
    const probe = vi
      .fn<() => Promise<ReadinessResult>>()
      .mockResolvedValueOnce({ component: "Voice worker", ok: false, url: "http://localhost:8082/_readyz", reason: "HTTP 503" })
      .mockResolvedValueOnce({ component: "Voice worker", ok: true, url: "http://localhost:8082/_readyz" });
    const sleep = vi.fn(async () => undefined);

    await expect(waitForReadiness(probe, { intervalMs: 1, timeoutMs: 50, sleep })).resolves.toEqual({
      component: "Voice worker",
      ok: true,
      url: "http://localhost:8082/_readyz",
    });
    expect(sleep).toHaveBeenCalledOnce();
  });
});
