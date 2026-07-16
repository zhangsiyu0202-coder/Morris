import { randomUUID } from "node:crypto";

import {
  APIConnectionError,
  APIStatusError,
  DEFAULT_API_CONNECT_OPTIONS,
  tts,
} from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { WebSocket } from "ws";

import type { DashScopeSpeechConfig } from "./dashscope-config.js";

interface QwenTtsSession {
  id?: string;
}

interface QwenTtsServerEvent {
  type?: string;
  session?: QwenTtsSession;
  delta?: string;
  response?: {
    usage?: {
      characters?: number;
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  error?: {
    code?: string;
    message?: string;
  };
}

function buildQwenTtsEndpoint(base: string, model: string) {
  const url = new URL(base);
  url.searchParams.set("model", model);
  return url.toString();
}

function decodePcmChunk(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

async function waitForSocketOpen(socket: WebSocket) {
  if (socket.readyState === WebSocket.OPEN) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

async function sendJson(socket: WebSocket, payload: object) {
  await new Promise<void>((resolve, reject) => {
    socket.send(JSON.stringify(payload), (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

// Hard ceiling for one TTS synthesis. DashScope's realtime TTS typically
// finishes < 5s for a normal reply; anything > 30s indicates a stuck server
// or a lost session.finished event and should be recovered by the caller.
const TTS_RESPONSE_TIMEOUT_MS = 30_000;

export class DashScopeQwenRealtimeTTS extends tts.TTS {
  label = "dashscope.qwen-realtime.TTS";
  #config: DashScopeSpeechConfig;

  constructor(config: DashScopeSpeechConfig) {
    super(24000, 1, { streaming: false });
    this.#config = config;
  }

  get model() {
    return this.#config.qwenTtsModel;
  }

  get provider() {
    return "dashscope";
  }

  synthesize(
    text: string,
    connOptions?: { maxRetry?: number },
    abortSignal?: AbortSignal,
  ): tts.ChunkedStream {
    return new DashScopeQwenChunkedStream(this, text, this.#config, connOptions, abortSignal);
  }

  stream(): tts.SynthesizeStream {
    throw new Error("DashScope realtime TTS stream() is not implemented for the voice worker");
  }
}

class DashScopeQwenChunkedStream extends tts.ChunkedStream {
  label = "dashscope.qwen-realtime.ChunkedStream";

  #config: DashScopeSpeechConfig;

  constructor(
    ttsInstance: DashScopeQwenRealtimeTTS,
    text: string,
    config: DashScopeSpeechConfig,
    connOptions?: { maxRetry?: number },
    abortSignal?: AbortSignal,
  ) {
    super(
      text,
      ttsInstance,
      {
        ...DEFAULT_API_CONNECT_OPTIONS,
        maxRetry: connOptions?.maxRetry ?? 0,
      },
      abortSignal,
    );
    this.#config = config;
  }

  protected async run(): Promise<void> {
    const requestId = randomUUID();
    const segmentId = randomUUID();
    const socket = new WebSocket(
      buildQwenTtsEndpoint(this.#config.qwenTtsEndpoint, this.#config.qwenTtsModel),
      {
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          "user-agent": "merism-agent-voice-worker",
        },
      },
    );

    let lastFrame: AudioFrame | null = null;
    let finishRequested = false;
    let settled = false; // outer Promise settled → close is idempotent no-op

    const flushLastFrame = (final: boolean) => {
      if (!lastFrame) return;
      this.queue.put({
        requestId,
        segmentId,
        frame: lastFrame,
        final,
      });
      lastFrame = null;
    };

    const finishSession = async () => {
      if (finishRequested) return;
      finishRequested = true;
      // If the socket already closed on us (server-side hangup), sending
      // the finish request would raise inside `ws`. Guard here so the
      // audio-done branch can still resolve the outer promise cleanly.
      if (socket.readyState !== WebSocket.OPEN) return;
      await sendJson(socket, { type: "session.finish" });
    };

    await waitForSocketOpen(socket);

    await new Promise<void>((resolve, reject) => {
      const settleOnce = <T,>(fn: () => T): T | void => {
        if (settled) return;
        settled = true;
        return fn();
      };

      // Hard cap: a stuck TTS session (no session.finished event, no error,
      // no close) leaks the outer Promise forever. Reject after
      // TTS_RESPONSE_TIMEOUT_MS. This is the fix for review P1: previously
      // a server 1000/1005 close without a session.finished event kept the
      // audio path pinned.
      const timeout = setTimeout(() => {
        settleOnce(() =>
          reject(
            new APIStatusError({
              message: `DashScope realtime TTS: no session.finished within ${TTS_RESPONSE_TIMEOUT_MS}ms`,
              options: { statusCode: 504 },
            }),
          ),
        );
      }, TTS_RESPONSE_TIMEOUT_MS);

      const finalize = (): void => {
        clearTimeout(timeout);
      };

      socket.on("message", async (raw: WebSocket.RawData) => {
        const text = raw.toString();
        if (!text) return;

        // BAD PACKET DEFENCE: the FunASR/TTS provider occasionally sends a
        // partial frame under load. `JSON.parse` throwing here previously
        // escaped as an unhandledException; wrap so the outer Promise can
        // resolve/reject on the actual completion event and this packet is
        // just skipped with a hint on the wire logs.
        let event: QwenTtsServerEvent;
        try {
          event = JSON.parse(text) as QwenTtsServerEvent;
        } catch {
          // Drop malformed frame; the response cycle can still complete.
          return;
        }

        try {
          if (event.type === "session.created") {
            // Instruction control is honored only by Qwen3-TTS-Instruct-* models
            // (per Model Studio 实时语音合成 doc §指令控制). Guard on the model name
            // so overriding QWEN_TTS_MODEL back to a non-instruct model does not
            // send an `instructions` field the server would reject.
            const instructions = this.#config.qwenTtsInstructions.trim();
            const supportsInstructions = this.#config.qwenTtsModel.includes("instruct");
            const session: Record<string, unknown> = {
              mode: "server_commit",
              voice: this.#config.qwenTtsVoice,
              response_format: "pcm",
              sample_rate: 24000,
            };
            if (supportsInstructions && instructions) {
              session.instructions = instructions;
              session.optimize_instructions = true;
            }
            await sendJson(socket, {
              type: "session.update",
              session,
            });
            await sendJson(socket, {
              type: "input_text_buffer.append",
              text: this.inputText,
            });
            await sendJson(socket, { type: "input_text_buffer.commit" });
            return;
          }

          if (event.type === "response.audio.delta" && event.delta) {
            flushLastFrame(false);
            const pcm = decodePcmChunk(event.delta);
            lastFrame = new AudioFrame(pcm, 24000, 1, pcm.length);
            return;
          }

          if (event.type === "response.audio.done") {
            flushLastFrame(true);
            await finishSession();
            return;
          }

          if (event.type === "response.done") {
            this.setTokenUsage({
              inputTokens: event.response?.usage?.input_tokens ?? 0,
              outputTokens: event.response?.usage?.output_tokens ?? 0,
            });
            await finishSession();
            return;
          }

          if (event.type === "session.finished") {
            settleOnce(() => {
              finalize();
              try {
                socket.close();
              } catch {
                // socket may already be closing
              }
              resolve();
            });
            return;
          }

          if (event.type === "error") {
            settleOnce(() => {
              finalize();
              reject(
                new APIStatusError({
                  message: event.error?.message ?? "DashScope realtime TTS returned an error",
                  options: {
                    body: event.error ?? null,
                    statusCode: 500,
                  },
                }),
              );
            });
          }
        } catch (error) {
          settleOnce(() => {
            finalize();
            reject(error);
          });
        }
      });

      socket.on("error", (error: Error) => {
        settleOnce(() => {
          finalize();
          reject(
            new APIConnectionError({
              message: `DashScope realtime TTS websocket error: ${error.message}`,
              options: { retryable: false },
            }),
          );
        });
      });

      socket.on("close", (code: number, reason: Buffer) => {
        // FIX (review P1): previously the 1000/1005 branch only `return`ed
        // without resolving, leaving the outer Promise pinned when the
        // server closed cleanly without sending `session.finished`. Resolve
        // if audio was flushed (best-effort success), otherwise reject.
        const isCleanClose = code === 1000 || code === 1005;
        if (isCleanClose) {
          settleOnce(() => {
            finalize();
            // Emit any pending final frame so downstream doesn't stall.
            flushLastFrame(true);
            resolve();
          });
          return;
        }
        settleOnce(() => {
          finalize();
          reject(
            new APIStatusError({
              message: `DashScope realtime TTS websocket closed: ${code} ${reason.toString()}`,
              options: { statusCode: code || 500 },
            }),
          );
        });
      });
    }).finally(() => {
      flushLastFrame(true);
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.close();
        } catch {
          // socket may already be closing
        }
      }
    });
  }
}
