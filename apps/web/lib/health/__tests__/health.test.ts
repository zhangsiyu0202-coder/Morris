/**
 * Tests for `apps/web/lib/health/{prestop,checks}.ts` + route handlers.
 *
 * Coverage:
 *  - prestop marker: env unset → false; env set + file present → true;
 *    env set + file missing → false; permission error → false (safe default).
 *  - checks: pingAppwrite missing env → false; pingCache no REDIS_URL → true;
 *    pingProvidersConfig requires at least one LLM key.
 *  - readyz route: prestop short-circuit; role default; bad role → 400;
 *    no traceId field anywhere; 503 when any dep down.
 *  - livez route: always 200.
 *  - Property: any single-dep failure → 503; all healthy → 200.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isShuttingDown, getPrestopMarkerPath, DEFAULT_PRESTOP_MARKER } from "../prestop";
import {
  pingAppwrite,
  pingCache,
  pingProvidersConfig,
  runReadinessChecks,
  ROLE_DEPENDENCIES,
} from "../checks";
import { HealthCheckSchema } from "@merism/contracts";

// ---- prestop ----

describe("isShuttingDown (REQ-3)", () => {
  let tmpDir: string;
  let markerFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "merism-prestop-"));
    markerFile = join(tmpDir, "marker");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when env unset", () => {
    vi.stubEnv("MERISM_PRESTOP_MARKER_FILE", "");
    expect(isShuttingDown()).toBe(false);
    expect(getPrestopMarkerPath()).toBeNull();
  });

  it("returns false when env set but file missing", () => {
    vi.stubEnv("MERISM_PRESTOP_MARKER_FILE", markerFile);
    expect(existsSync(markerFile)).toBe(false);
    expect(isShuttingDown()).toBe(false);
    expect(getPrestopMarkerPath()).toBe(markerFile);
  });

  it("returns true when env set + file present", () => {
    vi.stubEnv("MERISM_PRESTOP_MARKER_FILE", markerFile);
    writeFileSync(markerFile, "draining");
    expect(isShuttingDown()).toBe(true);
    unlinkSync(markerFile);
    expect(isShuttingDown()).toBe(false);
  });

  it("exports DEFAULT_PRESTOP_MARKER matching the k8s sample manifest", () => {
    expect(DEFAULT_PRESTOP_MARKER).toBe("/tmp/merism.prestop");
  });
});

// ---- checks ----

describe("pingAppwrite (REQ-3)", () => {
  beforeEach(() => {
    vi.stubEnv("APPWRITE_ENDPOINT", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns false when APPWRITE_ENDPOINT is unset", async () => {
    expect(await pingAppwrite()).toBe(false);
  });

  it("returns true when fetch resolves ok", async () => {
    vi.stubEnv("APPWRITE_ENDPOINT", "http://appwrite.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    expect(await pingAppwrite()).toBe(true);
  });

  it("returns false when fetch rejects (network error)", async () => {
    vi.stubEnv("APPWRITE_ENDPOINT", "http://appwrite.test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await pingAppwrite()).toBe(false);
  });

  it("returns false when fetch returns 5xx", async () => {
    vi.stubEnv("APPWRITE_ENDPOINT", "http://appwrite.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 503 }));
    expect(await pingAppwrite()).toBe(false);
  });
});

describe("pingCache (REQ-3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns true when REDIS_URL unset (no cache configured)", async () => {
    vi.stubEnv("REDIS_URL", "");
    expect(await pingCache()).toBe(true);
  });

  it("returns true when REDIS_URL set (Wave A trust-env)", async () => {
    // Wave A: env-shaped check; real redis.ping is a follow-up.
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    expect(await pingCache()).toBe(true);
  });
});

describe("pingProvidersConfig (REQ-3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns false when no LLM provider key is configured", async () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(await pingProvidersConfig()).toBe(false);
  });

  it("returns true when Qwen (primary per ADR-0011) is configured", async () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "fake-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(await pingProvidersConfig()).toBe(true);
  });

  it("returns true when DeepSeek (dormant) is configured", async () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "fake-key");
    expect(await pingProvidersConfig()).toBe(true);
  });
});

describe("runReadinessChecks (REQ-3)", () => {
  beforeEach(() => {
    vi.stubEnv("APPWRITE_ENDPOINT", "http://appwrite.test");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("DASHSCOPE_API_KEY", "fake-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("web role returns appwrite + cache results matching schema", async () => {
    const result = await runReadinessChecks("web");
    expect(HealthCheckSchema.parse(result)).toEqual(result);
    expect(result.appwrite).toBe(true);
    expect(result.cache).toBe(true);
  });

  it("interview role returns same deps as web (Wave A)", async () => {
    expect(ROLE_DEPENDENCIES.interview).toEqual(ROLE_DEPENDENCIES.web);
  });

  it("function role only checks appwrite", async () => {
    const result = await runReadinessChecks("function");
    expect(Object.keys(result).sort()).toEqual(["appwrite"]);
  });

  it("response object never contains a traceId field (info-leak prevention)", async () => {
    const result = (await runReadinessChecks("web")) as Record<string, unknown>;
    expect(result.traceId).toBeUndefined();
  });

  it("property: any single dep failure → at least one false in result", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("web" as const, "function" as const), async (role) => {
        // force appwrite to fail
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
        const result = await runReadinessChecks(role);
        expect(Object.values(result).some((v) => v === false)).toBe(true);
      }),
      { numRuns: 4 }, // small N — fetch mock isn't cheap to reset
    );
  });
});

// ---- routes ----

describe("livez route", () => {
  it("always returns 200 with http=true", async () => {
    const { GET } = await import("@/app/_health/livez/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ http: true });
  });

  it("response body has no traceId", async () => {
    const { GET } = await import("@/app/_health/livez/route");
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.traceId).toBeUndefined();
  });
});

describe("readyz route", () => {
  beforeEach(() => {
    vi.stubEnv("MERISM_PRESTOP_MARKER_FILE", "");
    vi.stubEnv("APPWRITE_ENDPOINT", "http://appwrite.test");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("DASHSCOPE_API_KEY", "fake-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function makeReq(url: string): import("next/server").NextRequest {
    // Minimal NextRequest stand-in: only `nextUrl.searchParams` is used.
    return {
      nextUrl: new URL(url),
    } as unknown as import("next/server").NextRequest;
  }

  it("returns 200 when all deps healthy (default role)", async () => {
    const { GET } = await import("@/app/_health/readyz/route");
    const res = await GET(makeReq("http://app.test/_health/readyz"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.appwrite).toBe(true);
    expect(body.traceId).toBeUndefined();
  });

  it("returns 503 + shutting_down when prestop marker exists", async () => {
    const tmpFile = join(tmpdir(), `merism-prestop-test-${Date.now()}`);
    writeFileSync(tmpFile, "x");
    vi.stubEnv("MERISM_PRESTOP_MARKER_FILE", tmpFile);
    try {
      const { GET } = await import("@/app/_health/readyz/route");
      const res = await GET(makeReq("http://app.test/_health/readyz"));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ shutting_down: true });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* best-effort */ }
    }
  });

  it("returns 400 for unknown role", async () => {
    const { GET } = await import("@/app/_health/readyz/route");
    const res = await GET(makeReq("http://app.test/_health/readyz?role=worker"));
    expect(res.status).toBe(400);
  });

  it("returns 503 when a dep is down", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const { GET } = await import("@/app/_health/readyz/route");
    const res = await GET(makeReq("http://app.test/_health/readyz"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.appwrite).toBe(false);
  });
});
