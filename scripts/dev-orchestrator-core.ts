export const LOCAL_DEV_ENDPOINTS = {
  appwrite: "http://localhost:8080/v1",
  web: "http://localhost:3000",
  livekit: "ws://localhost:7880",
  mastra: "http://localhost:4111",
  voiceWorker: "http://localhost:8082",
} as const;

type LocalDevEnvironment = Pick<NodeJS.ProcessEnv, "APPWRITE_ENDPOINT" | "APP_URL" | "LIVEKIT_URL">;

export type ReadinessResult = {
  component: string;
  ok: boolean;
  url: string;
  reason?: string;
};

const requiredEndpointEnvironment = [
  ["APPWRITE_ENDPOINT", LOCAL_DEV_ENDPOINTS.appwrite],
  ["APP_URL", LOCAL_DEV_ENDPOINTS.web],
  ["LIVEKIT_URL", LOCAL_DEV_ENDPOINTS.livekit],
] as const;

export function validateLocalDevEnvironment(environment: LocalDevEnvironment): string[] {
  return requiredEndpointEnvironment.flatMap(([name, expected]) => {
    const actual = environment[name];
    if (actual === expected) return [];

    return [`${name} must be ${expected} for dev:up (received ${actual ?? "unset"})`];
  });
}

export function formatReadinessSummary(results: ReadinessResult[]): string {
  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) return "All readiness checks passed.";

  return [
    "Readiness failed:",
    ...failures.map((failure) => `- ${failure.component}: ${failure.reason ?? "not ready"} (${failure.url})`),
  ].join("\n");
}
