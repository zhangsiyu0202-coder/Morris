import type { TranscriptSegment } from "@merism/contracts";

export interface UserInputTranscribed {
  transcript: string;
  isFinal: boolean;
  itemId: string | null;
  speakerId: string | null;
  createdAt: number;
  language: string | null;
}

export interface FinalizedTranscript {
  language: string;
  segments: TranscriptSegment[];
}

/**
 * Collects the LiveKit AgentSession's final user transcripts for one
 * interview. `createdAt` is the only timestamp exposed by the event, so the
 * persisted offset is relative to the worker session start.
 */
export class SessionTranscriptCollector {
  #startedAt: number;
  #language = "zh";
  #segments: TranscriptSegment[] = [];
  #recordedItemIds = new Set<string>();

  constructor({ startedAt }: { startedAt: number }) {
    this.#startedAt = startedAt;
  }

  record(event: UserInputTranscribed): boolean {
    if (!event.isFinal) return false;

    const text = event.transcript.trim();
    if (!text) return false;
    if (event.itemId && this.#recordedItemIds.has(event.itemId)) return false;
    if (event.itemId) this.#recordedItemIds.add(event.itemId);

    const offsetMs = Math.max(0, Math.floor(event.createdAt - this.#startedAt));
    this.#segments.push({
      // Agents JS currently reports `speakerId: null` for this event. This
      // worker only receives the anonymous interviewee's microphone input.
      speaker: "interviewee",
      startMs: offsetMs,
      endMs: offsetMs,
      text,
    });
    if (this.#segments.length === 1 && event.language) this.#language = event.language;
    return true;
  }

  get snapshot(): FinalizedTranscript | undefined {
    if (this.#segments.length === 0) return undefined;
    return {
      language: this.#language,
      segments: this.#segments.map((segment) => ({ ...segment })),
    };
  }
}
