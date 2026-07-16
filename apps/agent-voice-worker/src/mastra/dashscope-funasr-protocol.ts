import type { AudioFrame } from "@livekit/rtc-node";
import { WebSocket } from "ws";

export interface FunAsrSentence {
  begin_time?: number | null;
  end_time?: number | null;
  text?: string | null;
  heartbeat?: boolean | null;
  sentence_end?: boolean | null;
}

export interface FunAsrServerEvent {
  header?: { event?: string };
  payload?: {
    output?: { sentence?: FunAsrSentence | null } | null;
    usage?: { duration?: number | null } | null;
  } | null;
}

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

export function createDeferred(): Deferred {
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

export function toInt16Pcm(frame: AudioFrame): Uint8Array {
  return new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
}

export async function waitForOpen(socket: WebSocket): Promise<void> {
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

export async function sendJson(socket: WebSocket, payload: object): Promise<void> {
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

interface FunAsrRecognitionConfig {
  funAsrModel: string;
  language: string;
}

export function buildFunAsrRecognitionTask(taskId: string, config: FunAsrRecognitionConfig): object {
  return {
    header: { action: "run-task", task_id: taskId, streaming: "duplex" },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: config.funAsrModel,
      parameters: {
        format: "pcm",
        sample_rate: 16000,
        language_hints: [config.language],
        disfluency_removal_enabled: false,
        inverse_text_normalization_enabled: true,
      },
      input: {},
    },
  };
}

export function buildFunAsrFinishTask(taskId: string): object {
  return {
    header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
    payload: { input: {} },
  };
}
