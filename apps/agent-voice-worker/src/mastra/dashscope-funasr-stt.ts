import { randomUUID } from "node:crypto";

import {
  APIConnectionError,
  APIStatusError,
  DEFAULT_API_CONNECT_OPTIONS,
  asLanguageCode,
  type AudioBuffer,
  stt,
} from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { WebSocket } from "ws";

import type { DashScopeSpeechConfig } from "./dashscope-config";

interface FunAsrRunTaskRequest {
  header: {
    action: "run-task";
    task_id: string;
    streaming: "duplex";
  };
  payload: {
    task_group: "audio";
    task: "asr";
    function: "recognition";
    model: string;
    parameters: {
      format: "pcm";
      sample_rate: number;
      language_hints: string[];
      disfluency_removal_enabled: boolean;
      inverse_text_normalization_enabled: boolean;
    };
    input: Record<string, never>;
  };
}

interface FunAsrFinishTaskRequest {
  header: {
    action: "finish-task";
    task_id: string;
    streaming: "duplex";
  };
  payload: {
    input: Record<string, never>;
  };
}

interface FunAsrSentence {
  begin_time?: number | null;
  end_time?: number | null;
  text?: string | null;
  heartbeat?: boolean | null;
  sentence_end?: boolean | null;
}

interface FunAsrServerEvent {
  header?: {
    event?: string;
    task_id?: string;
  };
  payload?: {
    output?: {
      sentence?: FunAsrSentence | null;
    } | null;
    usage?: {
      duration?: number | null;
    } | null;
  };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function toInt16Pcm(frame: AudioFrame) {
  return new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
}

async function waitForOpen(socket: WebSocket) {
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

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;

  return {
    promise: new Promise<void>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    }),
    resolve,
    reject,
  };
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

export class DashScopeFunAsrRealtimeSTT extends stt.STT {
  label = "dashscope.funasr.STT";
  #config: DashScopeSpeechConfig;

  constructor(config: DashScopeSpeechConfig) {
    super({
      streaming: true,
      interimResults: true,
      alignedTranscript: "word",
    });
    this.#config = config;
  }

  get model() {
    return this.#config.funAsrModel;
  }

  get provider() {
    return "dashscope";
  }

  protected async _recognize(frame: AudioBuffer): Promise<stt.SpeechEvent> {
    const stream = this.stream();
    const chunks = Array.isArray(frame) ? frame : [frame as AudioFrame];
    for (const chunk of chunks) {
      stream.pushFrame(chunk);
    }
    stream.flush();

    for await (const event of stream) {
      if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
        stream.close();
        return event;
      }
    }

    throw new APIConnectionError({
      message: "FunASR recognize completed without a final transcript",
      options: { retryable: false },
    });
  }

  stream(options?: { connOptions?: { maxRetry?: number } }): stt.SpeechStream {
    return new DashScopeFunAsrSpeechStream(this, this.#config, options?.connOptions);
  }
}

class DashScopeFunAsrSpeechStream extends stt.SpeechStream {
  label = "dashscope.funasr.SpeechStream";

  #config: DashScopeSpeechConfig;
  #socket: WebSocket | null = null;
  #taskId: string | null = null;
  #taskStart: Deferred | null = null;
  #taskFinish: Deferred | null = null;
  #startedSpeech = false;
  #terminalError: Error | null = null;

  constructor(
    sttInstance: DashScopeFunAsrRealtimeSTT,
    config: DashScopeSpeechConfig,
    connOptions?: { maxRetry?: number },
  ) {
    super(sttInstance, 16000, {
      ...DEFAULT_API_CONNECT_OPTIONS,
      maxRetry: connOptions?.maxRetry ?? 0,
    });
    this.#config = config;
  }

  protected async run(): Promise<void> {
    this.#socket = new WebSocket(this.#config.funAsrEndpoint, {
      headers: {
        Authorization: `Bearer ${this.#config.apiKey}`,
        "user-agent": "merism-agent-voice-worker",
      },
    });

    const socket = this.#socket;

    socket.on("message", (raw: WebSocket.RawData) => {
      const text = raw.toString();
      if (!text) {
        return;
      }
      this.#handleServerEvent(text);
    });

    socket.on("error", (error: Error) => {
      this.#rejectOutstanding(
        new APIConnectionError({
          message: `FunASR websocket error: ${error.message}`,
          options: { retryable: false },
        }),
      );
    });

    socket.on("close", (code: number, reason: Buffer) => {
      if (this.closed || code === 1000 || code === 1005) {
        return;
      }
      this.#rejectOutstanding(
        new APIStatusError({
          message: `FunASR websocket closed: ${code} ${reason.toString()}`,
          options: { statusCode: code || 500 },
        }),
      );
    });

    await waitForOpen(socket);

    try {
      for await (const item of this.input) {
        if (item === stt.SpeechStream.FLUSH_SENTINEL) {
          await this.#finishTask();
          await this.#waitForTaskFinished();
          this.#throwIfFailed();
          continue;
        }

        await this.#ensureTaskStarted();
        this.#throwIfFailed();

        if (!this.#startedSpeech) {
          this.#startedSpeech = true;
          this.queue.put({ type: stt.SpeechEventType.START_OF_SPEECH });
        }

        await new Promise<void>((resolve, reject) => {
          socket.send(toInt16Pcm(item), { binary: true }, (error?: Error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }

      await this.#finishTask();
      await this.#waitForTaskFinished();
      this.#throwIfFailed();
    } finally {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    }
  }

  close() {
    super.close();
    if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
      this.#socket.close();
    }
  }

  async #ensureTaskStarted() {
    if (this.#taskStart) {
      await this.#taskStart.promise;
      return;
    }

    const taskId = randomUUID();
    this.#taskId = taskId;
    this.#taskStart = createDeferred();
    this.#taskFinish = createDeferred();

    const request: FunAsrRunTaskRequest = {
      header: {
        action: "run-task",
        task_id: taskId,
        streaming: "duplex",
      },
      payload: {
        task_group: "audio",
        task: "asr",
        function: "recognition",
        model: this.#config.funAsrModel,
        parameters: {
          format: "pcm",
          sample_rate: 16000,
          language_hints: [this.#config.language],
          disfluency_removal_enabled: false,
          inverse_text_normalization_enabled: true,
        },
        input: {},
      },
    };

    await sendJson(this.#socket!, request);
    await this.#taskStart.promise;
  }

  async #finishTask() {
    if (!this.#taskId) {
      return;
    }

    const finishRequest: FunAsrFinishTaskRequest = {
      header: {
        action: "finish-task",
        task_id: this.#taskId,
        streaming: "duplex",
      },
      payload: {
        input: {},
      },
    };

    await sendJson(this.#socket!, finishRequest);
  }

  async #waitForTaskFinished() {
    if (!this.#taskFinish) {
      return;
    }
    await this.#taskFinish.promise;
  }

  #throwIfFailed() {
    if (this.#terminalError) {
      throw this.#terminalError;
    }
  }

  #rejectOutstanding(error: Error) {
    if (this.#terminalError) {
      return;
    }
    this.#terminalError = error;
    this.#taskStart?.reject(error);
    this.#taskFinish?.reject(error);
  }

  #handleServerEvent(raw: string) {
    // BAD PACKET DEFENCE: previously an unparseable frame would throw
    // synchronously inside the `socket.on("message")` callback and become
    // an unhandled exception, leaving `#taskStart` / `#taskFinish`
    // deferreds pending forever (review P1). Translate any parse or
    // dispatch failure into a terminal-error rejection so the outer
    // `run()` promise settles.
    let event: FunAsrServerEvent;
    try {
      event = JSON.parse(raw) as FunAsrServerEvent;
    } catch (error) {
      this.#rejectOutstanding(
        new APIStatusError({
          message: `FunASR: malformed server frame: ${
            error instanceof Error ? error.message : String(error)
          }`,
          options: { statusCode: 502 },
        }),
      );
      return;
    }

    try {
      this.#dispatchEvent(event);
    } catch (error) {
      this.#rejectOutstanding(
        error instanceof Error
          ? error
          : new APIStatusError({
              message: `FunASR dispatch failed: ${String(error)}`,
              options: { statusCode: 500 },
            }),
      );
    }
  }

  #dispatchEvent(event: FunAsrServerEvent) {
    const kind = event.header?.event;

    if (kind === "task-started") {
      this.#taskStart?.resolve();
      return;
    }

    if (kind === "result-generated") {
      const sentence = event.payload?.output?.sentence;
      if (!sentence || sentence.heartbeat || !sentence.text) {
        return;
      }

      const transcript: stt.SpeechData = {
        language: asLanguageCode(this.#config.language),
        text: sentence.text,
        startTime: (sentence.begin_time ?? 0) / 1000,
        endTime: (sentence.end_time ?? sentence.begin_time ?? 0) / 1000,
        confidence: 1,
      };

      this.queue.put({
        type: sentence.sentence_end
          ? stt.SpeechEventType.FINAL_TRANSCRIPT
          : stt.SpeechEventType.INTERIM_TRANSCRIPT,
        alternatives: [transcript],
      });
      if (sentence.sentence_end && event.payload?.usage?.duration != null) {
        this.queue.put({
          type: stt.SpeechEventType.RECOGNITION_USAGE,
          recognitionUsage: {
            audioDuration: event.payload.usage.duration,
          },
        });
      }
      return;
    }

    if (kind === "task-finished") {
      if (this.#startedSpeech) {
        this.queue.put({ type: stt.SpeechEventType.END_OF_SPEECH });
      }
      this.#taskFinish?.resolve();
      this.#taskId = null;
      this.#taskStart = null;
      this.#taskFinish = null;
      this.#startedSpeech = false;
      return;
    }

    if (kind === "task-failed") {
      this.#rejectOutstanding(
        new APIStatusError({
          message: "FunASR task failed",
          options: {
            body: event.payload ?? null,
            statusCode: 500,
          },
        }),
      );
    }
  }
}
