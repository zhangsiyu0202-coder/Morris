interface VoiceWorkerEnvironment {
  LIVEKIT_INIT_PROCESS_TIMEOUT_MS?: string;
  LIVEKIT_NUM_IDLE_PROCESSES?: string;
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  variableName: string,
): number {
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${variableName} must be a positive integer`);
  }
  return value;
}

/**
 * LiveKit runs one job in each child process. Keep one initialized child
 * ready so @mastra/livekit's built-in Silero VAD `prewarm` hook completes
 * before an interviewee joins. Source: https://docs.livekit.io/agents/server/options/#job-processes
 */
export function buildVoiceWorkerServerOptions(
  env: VoiceWorkerEnvironment = process.env,
): { initializeProcessTimeout: number; numIdleProcesses: number } {
  return {
    initializeProcessTimeout: positiveInteger(
      env.LIVEKIT_INIT_PROCESS_TIMEOUT_MS,
      60_000,
      "LIVEKIT_INIT_PROCESS_TIMEOUT_MS",
    ),
    numIdleProcesses: positiveInteger(
      env.LIVEKIT_NUM_IDLE_PROCESSES,
      1,
      "LIVEKIT_NUM_IDLE_PROCESSES",
    ),
  };
}
