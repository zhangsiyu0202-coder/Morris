/**
 * Feedback rating shape — kept in a plain module (NOT `"use server"`) so the
 * schema constant can be exported safely. A `"use server"` file is only allowed
 * to export async functions (Next.js
 * https://nextjs.org/docs/messages/invalid-use-server-value); putting the Zod
 * enum here keeps `feedback.ts` strictly Server-Action-shaped while still
 * letting any consumer import the type without pulling in server code.
 */
import { z } from "zod";

export const FeedbackRatingSchema = z.enum(["up", "down"]);
export type FeedbackRating = z.infer<typeof FeedbackRatingSchema>;
