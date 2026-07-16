export const LOCAL_DEV_ENDPOINTS = {
  appwrite: "http://localhost:8080/v1",
  web: "http://localhost:3000",
  livekit: "ws://localhost:7880",
  voiceWorker: "http://localhost:8082",
} as const;

type LocalDevEnvironment = {
  APPWRITE_ENDPOINT?: string;
  APP_URL?: string;
  LIVEKIT_URL?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
};

export type ReadinessResult = {
  component: string;
  ok: boolean;
  url: string;
  reason?: string;
};

export type ReadinessTarget = Pick<ReadinessResult, "component" | "url">;

type HttpResponse = Pick<Response, "ok" | "status">;
type HttpRequest = (url: string, init: RequestInit) => Promise<HttpResponse>;
type Sleeper = (milliseconds: number) => Promise<void>;

const requiredEndpointEnvironment = [
  ["APPWRITE_ENDPOINT", LOCAL_DEV_ENDPOINTS.appwrite],
  ["APP_URL", LOCAL_DEV_ENDPOINTS.web],
  ["LIVEKIT_URL", LOCAL_DEV_ENDPOINTS.livekit],
] as const;

export function localReadinessTargets(): ReadinessTarget[] {
  return [
    { component: "Appwrite", url: `${LOCAL_DEV_ENDPOINTS.appwrite}/health/version` },
    { component: "LiveKit", url: `${LOCAL_DEV_ENDPOINTS.livekit.replace("ws://", "http://")}/` },
    { component: "Web", url: `${LOCAL_DEV_ENDPOINTS.web}/_health/readyz?role=web` },
    { component: "Voice worker", url: `${LOCAL_DEV_ENDPOINTS.voiceWorker}/_readyz` },
  ];
}

export function readinessTimeoutMs(component: string): number {
  return 90_000;
}

export function validateLocalDevEnvironment(environment: LocalDevEnvironment): string[] {
  const endpointFailures = requiredEndpointEnvironment.flatMap(([name, expected]) => {
    const actual = environment[name];
    if (actual === expected) return [];

    return [`${name} must be ${expected} for dev:up (received ${actual ?? "unset"})`];
  });
  return environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY
    ? endpointFailures
    : [...endpointFailures, "GEMINI_API_KEY or GOOGLE_API_KEY must be set for the Gemini Live voice worker"];
}

export function formatReadinessSummary(results: ReadinessResult[]): string {
  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) return "All readiness checks passed.";

  return [
    "Readiness failed:",
    ...failures.map((failure) => `- ${failure.component}: ${failure.reason ?? "not ready"} (${failure.url})`),
  ].join("\n");
}

export async function checkHttpReadiness(
  component: string,
  url: string,
  request: HttpRequest = (input, init) => fetch(input, init),
): Promise<ReadinessResult> {
  try {
    const response = await request(url, { signal: AbortSignal.timeout(3_000) });
    if (response.ok) return { component, ok: true, url };
    return { component, ok: false, url, reason: `HTTP ${response.status}` };
  } catch (error) {
    return {
      component,
      ok: false,
      url,
      reason: error instanceof Error ? error.message : "request failed",
    };
  }
}

export async function waitForReadiness(
  probe: () => Promise<ReadinessResult>,
  options: { timeoutMs: number; intervalMs: number; sleep?: Sleeper; stopReason?: () => string | undefined },
): Promise<ReadinessResult> {
  const deadline = Date.now() + options.timeoutMs;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (;;) {
    const result = await probe();
    if (result.ok) return result;
    const stopReason = options.stopReason?.();
    if (stopReason) return { ...result, reason: stopReason };
    if (Date.now() >= deadline) {
      return {
        ...result,
        reason: `${result.reason ?? "not ready"} after ${options.timeoutMs}ms`,
      };
    }
    await sleep(options.intervalMs);
  }
}
