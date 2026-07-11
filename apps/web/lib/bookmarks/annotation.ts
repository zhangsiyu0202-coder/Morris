/**
 * Pure normalization for researcher bookmark annotations (note + tags).
 *
 * Kept out of the `"use server"` action module so it is unit-testable without
 * pulling the Appwrite SDK, and reused by both the action boundary and any
 * future caller. Total functions — they never throw; they deterministically
 * clamp/dedupe so the action never has to invent error codes for "too long".
 */

export const MAX_BOOKMARK_NOTE_LENGTH = 10_000;
export const MAX_BOOKMARK_TAGS = 12;
export const MAX_BOOKMARK_TAG_LENGTH = 64;

/** Trim and clamp a free-text note to the persisted column budget. */
export function normalizeBookmarkNote(input: string): string {
  return input.trim().slice(0, MAX_BOOKMARK_NOTE_LENGTH);
}

/**
 * Trim each tag, drop empties, dedupe (case-sensitive), clamp per-tag length to
 * the schema attribute size, and cap the count. Order of first appearance is
 * preserved.
 */
export function normalizeBookmarkTags(input: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = raw.trim().slice(0, MAX_BOOKMARK_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_BOOKMARK_TAGS) break;
  }
  return out;
}
