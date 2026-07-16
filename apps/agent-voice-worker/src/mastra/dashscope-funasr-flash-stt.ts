import { APIStatusError, asLanguageCode, stt, type AudioBuffer } from "@livekit/agents";
import { createLogger } from "@merism/observability";

import type { DashScopeSpeechConfig } from "./dashscope-config.js";

const log = createLogger("agent.stt.fun-asr-flash");

/**
 * Non-streaming Fun-ASR-Flash STT (`fun-asr-flash-2026-06-15`).
 *
 * Fun-ASR realtime has no "disable VAD" switch, so to let LiveKit's silero VAD +
 * v1-mini TurnDetector own turn boundaries we use a NON-streaming STT here:
 * LiveKit auto-wraps it with `stt.StreamAdapter`, which uses the session VAD to
 * cut each utterance and calls `_recognize()` once per utterance. There is no
 * Fun-ASR-side streaming VAD in this path.
 *
 * Transport: DashScope multimodal-generation sync HTTP endpoint. Per the 非实时
 * 语音识别 doc, `fun-asr-flash-2026-06-15` supports synchronous calls for audio
 * up to 5 minutes. The response shape is non-standard: recognized text is at
 * `output.text` (fallback `output.output.sentence.text`), with no `choices`.
 * Source: https://www.alibabacloud.com/help/zh/model-studio/non-realtime-speech-recognition-user-guide
 *
 * Tradeoff (vs the streaming realtime adapter): no interim transcripts, and one
 * HTTP round-trip of recognition latency after each utterance ends. Acceptable
 * for turn-based interviews (one answer per turn) but must be validated with a
 * live multi-turn session.
 */

interface FunAsrFlashResponse {
  output?: {
    text?: string;
    output?: { sentence?: { text?: string } };
  };
  request_id?: string;
  code?: string;
  message?: string;
}

/** Merge a LiveKit AudioBuffer (frame or frames) into one mono PCM16 buffer. */
function mergePcm(buffer: AudioBuffer): { pcm: Int16Array; sampleRate: number } {
  const frames = Array.isArray(buffer) ? buffer : [buffer];
  if (frames.length === 0) return { pcm: new Int16Array(0), sampleRate: 16000 };
  const sampleRate = frames[0].sampleRate;
  let total = 0;
  for (const f of frames) total += f.data.length;
  const pcm = new Int16Array(total);
  let offset = 0;
  for (const f of frames) {
    pcm.set(f.data, offset);
    offset += f.data.length;
  }
  return { pcm, sampleRate };
}

/** Wrap mono PCM16 samples in a 44-byte WAV header and base64-encode. */
function pcmToWavBase64(pcm: Int16Array, sampleRate: number): string {
  const bytesPerSample = 2;
  const dataBytes = pcm.length * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  header.writeUInt16LE(bytesPerSample, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Buffer.concat([header, data]).toString("base64");
}

export class DashScopeFunAsrFlashSTT extends stt.STT {
  label = "dashscope.fun-asr-flash.STT";
  #config: DashScopeSpeechConfig;

  constructor(config: DashScopeSpeechConfig) {
    // Non-streaming: LiveKit wraps this with StreamAdapter using the session VAD.
    super({ streaming: false, interimResults: false });
    this.#config = config;
  }

  get model() {
    return this.#config.funAsrFlashModel;
  }

  get provider() {
    return "dashscope";
  }

  /**
   * Non-streaming STT: LiveKit wraps this with `stt.StreamAdapter` (VAD-driven),
   * which is what provides the SpeechStream. Calling `stream()` on the raw STT is
   * not supported and indicates a wiring mistake.
   */
  stream(): never {
    throw new Error(
      "DashScopeFunAsrFlashSTT is non-streaming; LiveKit must wrap it with StreamAdapter (provide a session VAD).",
    );
  }

  protected async _recognize(
    buffer: AudioBuffer,
    abortSignal?: AbortSignal,
  ): Promise<stt.SpeechEvent> {
    const { pcm, sampleRate } = mergePcm(buffer);
    const durationSec = sampleRate > 0 ? pcm.length / sampleRate : 0;
    log.info("recognize:start", { samples: pcm.length, sampleRate, durationSec });
    const dataUrl = `data:audio/wav;base64,${pcmToWavBase64(pcm, sampleRate)}`;

    const body = {
      model: this.#config.funAsrFlashModel,
      input: {
        messages: [
          {
            role: "user",
            content: [{ type: "input_audio", input_audio: { data: dataUrl } }],
          },
        ],
      },
      parameters: { format: "wav", sample_rate: String(sampleRate) },
    };

    let response: Response;
    try {
      response = await fetch(this.#config.funAsrFlashHttpEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          "Content-Type": "application/json",
          "X-DashScope-SSE": "disable",
        },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
    } catch (error) {
      throw new APIStatusError({
        message: `Fun-ASR-Flash request failed: ${error instanceof Error ? error.message : String(error)}`,
        options: { statusCode: 500 },
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log.error("recognize:http-error", { status: response.status, body: text.slice(0, 200) });
      throw new APIStatusError({
        message: `Fun-ASR-Flash HTTP ${response.status}: ${text.slice(0, 500)}`,
        options: { statusCode: response.status },
      });
    }

    const json = (await response.json()) as FunAsrFlashResponse;
    // Non-standard response: text at output.text (fallback output.output.sentence.text).
    const text = (json.output?.text ?? json.output?.output?.sentence?.text ?? "").trim();
    log.info("recognize:done", { textLen: text.length, textHead: text.slice(0, 40) });

    return {
      type: stt.SpeechEventType.FINAL_TRANSCRIPT,
      requestId: json.request_id,
      alternatives: [
        {
          language: asLanguageCode(this.#config.language),
          text,
          startTime: 0,
          endTime: durationSec,
          confidence: 1,
        },
      ],
    };
  }
}
