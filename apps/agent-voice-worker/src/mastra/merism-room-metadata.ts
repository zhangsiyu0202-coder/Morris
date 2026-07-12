import { Agent } from "@mastra/core/agent";

import {
  InterviewRoomMetadataSchema,
  type InterviewFlowConfig,
  type InterviewRoomMetadata,
} from "@merism/contracts";
import { voiceWorkerModel } from "./model";

/**
 * Discriminated parse result. The old `parseJson` silently returned `null` on
 * bad input, which was exactly the `try/catch{}` fallback pattern forbidden by
 * `.kiro/steering/errors-and-observability.md` § try/catch matrix + the
 * `.semgrep/rules/no-silent-catch-fallback.yaml` rule. Callers now receive a
 * structured reason so `voice-worker.ts` can fail-closed (log at `error` and
 * refuse the job) instead of falling through to a generic assistant.
 */
export type RoomMetadataParseResult =
  | { ok: true; metadata: InterviewRoomMetadata }
  | { ok: false; reason: "empty" | "invalid_json" | "schema_mismatch"; detail?: string };

function parseJsonSafe(raw: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Parse and validate `ctx.room.metadata`. Returns a discriminated result so
 * callers can distinguish "no metadata sent" (`empty`) from "metadata sent but
 * malformed" (`invalid_json` / `schema_mismatch`) — the two cases have different
 * treatments in `voice-worker.ts` (fail-closed only on the malformed cases).
 */
export function parseMerismRoomMetadata(rawMetadata: string | undefined | null): RoomMetadataParseResult {
  if (!rawMetadata || rawMetadata.trim().length === 0 || rawMetadata.trim() === "{}") {
    return { ok: false, reason: "empty" };
  }
  const jsonResult = parseJsonSafe(rawMetadata);
  if (!jsonResult.ok) {
    return { ok: false, reason: "invalid_json", detail: jsonResult.error.message };
  }
  const parsed = InterviewRoomMetadataSchema.safeParse(jsonResult.value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_mismatch",
      detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(","),
    };
  }
  return { ok: true, metadata: parsed.data };
}

/**
 * Extract the `InterviewFlowConfig` from room metadata.
 *
 * Per the flow-engine refactor HANDOFF.md § key design decision 6 ("legacy
 * fallback allows old pipeline to keep running"), the returned config is
 * `null` when the room does not carry a `flowConfig` shape. `voice-worker`
 * must fail-closed on that case in the ADR-0013 iteration 5 world because
 * the legacy Python fallback path has been removed and the TS worker only
 * consumes the flow-engine shape.
 *
 * `issueLivekitToken` always emits `flowConfig` alongside the legacy
 * `runtimeStudy` / `workflowConfig` (per `buildInterviewRoomMetadataFromDraft`
 * P3 slice), so under normal operation this returns non-null.
 */
export function flowConfigFromMerismRoomMetadata(
  metadata: InterviewRoomMetadata | null,
): InterviewFlowConfig | null {
  return metadata?.flowConfig ?? null;
}

/**
 * Compose a short textual outline of the flow so the Mastra Agent has an
 * at-a-glance sense of the interview. The engine is the authoritative
 * cursor; this outline is purely informational for the LLM's speech.
 */
function buildFlowOutline(config: InterviewFlowConfig): string {
  const lines: string[] = ["Interview steps (graph order):"];
  for (const step of config.steps) {
    switch (step.kind) {
      case "question": {
        const opts = step.options.length > 0 ? ` [options: ${step.options.map((o) => o.content).join(", ")}]` : "";
        lines.push(`- ${step.stepId} (question): ${step.content}${opts}`);
        break;
      }
      case "probe":
        lines.push(
          `- ${step.stepId} (probe for ${step.forQuestionStepId}, up to ${step.maxRounds} rounds): ${step.instruction || "(no instruction)"}`,
        );
        break;
      case "condition":
        lines.push(
          `- ${step.stepId} (condition, ${step.items.length} branch${step.items.length === 1 ? "" : "es"})`,
        );
        break;
    }
  }
  return lines.join("\n");
}

/**
 * Build a session-scoped Mastra `Agent` from a flow config.
 *
 * Per HANDOFF.md § key design decision 2, the instructions are composed
 * from `moderatorInstruction` (researcher-authored persona + operational
 * rules pre-composed on the TS side by `buildInterviewFlowConfigFromDraft`).
 * The word "supervisor" is intentionally dropped — it referred to the
 * pre-flow-engine architecture where a `LiveKit Supervisor` owned the
 * cursor. In the flow-engine world the cursor is owned by `run_flow`, and
 * the Agent only speaks the questions on demand.
 *
 * The returned agent is only the LLM loop. The actual state machine
 * (step traversal / probe rounds / condition eval / first-writer-wins)
 * lives in `FlowEngineDriver` + `LiveKitFlowHost`. The agent's instructions
 * describe the interview shape so the LLM speaks naturally, but the
 * engine — not the prompt — decides which step is active.
 */
export function buildMerismVoiceAgent(config: InterviewFlowConfig, sessionId: string) {
  const instructions = [
    config.moderatorInstruction,
    `Session ID: ${sessionId}`,
    `Survey ID: ${config.surveyId}`,
    buildFlowOutline(config),
    "Do not mention internal step identifiers aloud.",
  ].join("\n\n");

  return new Agent({
    id: `voiceInterview:${sessionId}`,
    name: "Merism Voice Interview Agent",
    instructions,
    model: voiceWorkerModel,
  });
}
