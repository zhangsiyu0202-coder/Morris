import type { ReadinessResult } from "./dev-orchestrator-core";

export type LocalProcessDefinition = {
  component: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

export const REQUIRED_LOCAL_FUNCTIONS = [
  "issueLivekitToken",
  "finalizeInterviewSession",
  "analyzeSession",
  "analyzeSurvey",
  "analyzeSessionVisual",
] as const;

type FunctionEnvironment = Pick<NodeJS.ProcessEnv, "APPWRITE_ENDPOINT" | "APPWRITE_PROJECT_ID" | "APPWRITE_API_KEY">;
type HttpResponse = Pick<Response, "ok" | "status" | "json">;
type HttpRequest = (url: string, init: RequestInit) => Promise<HttpResponse>;

export function localProcessDefinitions(root: string): LocalProcessDefinition[] {
  return [
    {
      component: "Web",
      command: "pnpm",
      args: ["-F", "@merism/web", "dev", "--", "--port", "3000"],
      cwd: root,
      env: { NEXT_TELEMETRY_DISABLED: "1" },
    },
    {
      component: "Mastra",
      command: "pnpm",
      args: ["-F", "@merism/agent-voice-worker", "dev"],
      cwd: root,
      env: { MASTRA_PORT: "4111" },
    },
    {
      component: "Voice worker",
      command: "pnpm",
      args: ["-F", "@merism/agent-voice-worker", "dev:worker"],
      cwd: root,
      env: { HEALTH_PORT: "8082" },
    },
  ];
}

export async function checkFunctionDeployments(
  environment: FunctionEnvironment,
  request: HttpRequest = (url, init) => fetch(url, init),
): Promise<ReadinessResult[]> {
  const endpoint = environment.APPWRITE_ENDPOINT?.replace(/\/$/, "");
  if (!endpoint || !environment.APPWRITE_PROJECT_ID || !environment.APPWRITE_API_KEY) {
    return REQUIRED_LOCAL_FUNCTIONS.map((functionId) => ({
      component: `Function: ${functionId}`,
      ok: false,
      url: `${endpoint ?? "APPWRITE_ENDPOINT unset"}/functions/${functionId}/deployments`,
      reason: "Appwrite function credentials are not configured",
    }));
  }

  return Promise.all(REQUIRED_LOCAL_FUNCTIONS.map(async (functionId) => {
    const url = `${endpoint}/functions/${functionId}/deployments`;
    try {
      const response = await request(url, {
        headers: {
          "X-Appwrite-Project": environment.APPWRITE_PROJECT_ID!,
          "X-Appwrite-Key": environment.APPWRITE_API_KEY!,
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        return { component: `Function: ${functionId}`, ok: false, url, reason: `HTTP ${response.status}` };
      }
      const body = await response.json() as { deployments?: Array<{ status?: unknown }> };
      const ready = body.deployments?.some((deployment) => deployment.status === "ready") ?? false;
      return ready
        ? { component: `Function: ${functionId}`, ok: true, url }
        : { component: `Function: ${functionId}`, ok: false, url, reason: "no ready deployment" };
    } catch (error) {
      return {
        component: `Function: ${functionId}`,
        ok: false,
        url,
        reason: error instanceof Error ? error.message : "request failed",
      };
    }
  }));
}
