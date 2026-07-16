import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { createLogger } from "@merism/observability";

/**
 * Health + drain endpoints for the Mastra voice worker. Ports
 * `apps/agent/agent/health.py` (deleted per ADR-0013) to TypeScript.
 *
 * Two probes:
 *
 *   /_livez  — process is alive; returns 200 always. K8s uses this for the
 *              liveness probe. If it fails, the pod is restarted.
 *   /_readyz — worker is ready to accept new sessions. Returns 200 unless
 *              the SIGTERM drain marker file exists; then 503 so k8s stops
 *              routing new traffic. In-flight sessions continue to
 *              completion (LiveKit's shutdown grace window handles it).
 *
 * See `docs/dev/health-and-drain.md`. The Python worker used a background
 * daemon thread; Node's `http.createServer` is already event-loop based so
 * no extra threading is needed — the server runs alongside the LiveKit
 * worker loop.
 */

const DEFAULT_PORT = Number(process.env.HEALTH_PORT ?? "8081");
const PRESTOP_MARKER = process.env.HEALTH_PRESTOP_MARKER ?? "/tmp/merism-agent-voice-worker.draining";

export function writePrestopMarker(markerPath: string = PRESTOP_MARKER): void {
  try {
    mkdirSync(dirname(markerPath), { recursive: true });
  } catch {
    // best-effort — dirname of /tmp is /
  }
  writeFileSync(markerPath, `draining-since=${new Date().toISOString()}\n`);
}

export function clearPrestopMarker(markerPath: string = PRESTOP_MARKER): void {
  if (existsSync(markerPath)) {
    try {
      unlinkSync(markerPath);
    } catch {
      // ignore; the file will disappear with the pod
    }
  }
}

/** Clear a prior process's drain state before this replacement accepts work. */
export function prepareWorkerHealthServer(markerPath?: string): void {
  clearPrestopMarker(markerPath);
}

function isDraining(): boolean {
  return existsSync(PRESTOP_MARKER);
}

function respond(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/_livez") {
    respond(res, 200, { ok: true });
    return;
  }
  if (req.url === "/_readyz") {
    if (isDraining()) {
      respond(res, 503, { ok: false, reason: "draining" });
      return;
    }
    respond(res, 200, { ok: true });
    return;
  }
  respond(res, 404, { ok: false, reason: "not_found" });
}

export function startHealthServer(port: number = DEFAULT_PORT): () => void {
  const server = createServer(handle);
  server.listen(port);
  return () => server.close();
}

/**
 * Install SIGTERM + SIGINT handlers that flip `/_readyz` to 503 so k8s stops
 * routing new sessions to this pod. In-flight sessions continue running.
 * LiveKit's own shutdown callback (bound in `voice-worker.ts::onCallEnd`)
 * finalizes each session.
 */
export function installDrainHandler(): void {
  // Process-wide logger for the drain event. No sessionId at this level —
  // SIGTERM/SIGINT is a worker-lifecycle signal, not tied to any one call.
  const drainLog = createLogger("agent.drain");
  const handler = (signal: NodeJS.Signals) => {
    // Marker → next /_readyz → 503 → k8s stops sending new sessions.
    writePrestopMarker();
    drainLog.warn("signal received; readiness flipped to draining", { signal });
  };
  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
}
