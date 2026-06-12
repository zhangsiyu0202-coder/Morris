"use server";

/**
 * Feedback submission — thumbs up / thumbs down on individual assistant turns
 * (per code-review P2 #11). Currently observability-only: we log a structured
 * `morris.feedback` event so we can hand-eyeball quality signals via
 * the same tools that pick up `llm.call` (per `morris-llm-observability`).
 *
 * Persistence to a `morris_feedback` collection is **not** in this drop —
 * that's a separate sub-spec when we start cohort-analyzing feedback.
 * Until then this Server Action stays narrow: validate input + emit signal.
 */

import { z } from "zod";

import { createLogger } from "@merism/observability";
import { getCurrentUserId } from "@/lib/queries/auth";
import { loadConversationDoc } from "./server";

const log = createLogger("action.conversations.feedback");

export const FeedbackRatingSchema = z.enum(["up", "down"]);
export type FeedbackRating = z.infer<typeof FeedbackRatingSchema>;

const SubmitFeedbackInputSchema = z.object({
  conversationId: z.string().min(1).max(64),
  messageId: z.string().min(1).max(128),
  rating: FeedbackRatingSchema,
  feedbackText: z.string().max(2000).optional(),
});

export interface SubmitFeedbackResult {
  ok: true;
}

export async function submitFeedback(input: {
  conversationId: string;
  messageId: string;
  rating: FeedbackRating;
  feedbackText?: string;
}): Promise<SubmitFeedbackResult> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");

  const parsed = SubmitFeedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid_input: ${parsed.error.issues[0]?.message ?? "schema"}`);
  }

  // SECURITY: same posture as generateConversationTitle — Server Actions
  // are reachable directly via Next.js's RPC layer. An authenticated attacker
  // could submit feedback referencing a victim's conversationId and pollute
  // the morris.feedback signal stream (low-severity, but still tampering).
  // Verify the conversation belongs to the caller before logging.
  const doc = await loadConversationDoc(parsed.data.conversationId);
  if (!doc || doc.ownerUserId !== ownerUserId) {
    log.warn("morris.feedback.unauthorized", {
      conversationId: parsed.data.conversationId,
      ownerUserId,
    });
    throw new Error("not_authorized");
  }

  log.info("morris.feedback", {
    conversationId: parsed.data.conversationId,
    messageId: parsed.data.messageId,
    rating: parsed.data.rating,
    hasText: parsed.data.feedbackText !== undefined && parsed.data.feedbackText.length > 0,
    textLength: parsed.data.feedbackText?.length ?? 0,
    ownerUserId,
  });

  return { ok: true as const };
}
