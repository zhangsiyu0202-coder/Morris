/**
 * Notebook.shortId — 12-character alphanumeric URL-friendly id.
 *
 * Borrowed shape from PostHog's `generate_short_id` (8-byte randomness ↦ base36).
 * Unique within an owner (enforced by the `by_owner_short` unique index on the
 * `notebooks` collection); not globally unique. The shortId is what shows up in
 * `/notebooks/[shortId]` and `/share/notebook/[token]` URLs.
 *
 * 12 chars × log2(36) ≈ 62 bits of entropy. With 8 random bytes (64 bits) and
 * truncating-padding to 12 chars, collision probability per owner is negligible
 * for any realistic notebook count.
 *
 * See .kiro/specs/notebooks/design.md §5.1, R2.2.
 */

import { randomBytes } from "node:crypto";

const SHORT_ID_LEN = 12;
const SHORT_ID_PATTERN = /^[a-z0-9]{12}$/;

/**
 * Generate a fresh 12-char alphanumeric (lowercase) shortId. Uses 8 random
 * bytes (Node `crypto.randomBytes`) → bigint → base36 → padStart 12 → take 12.
 */
export function generateShortId(): string {
  const bytes = randomBytes(8);
  let n = 0n;
  for (const byte of bytes) {
    n = (n << 8n) | BigInt(byte);
  }
  // base36 lowercase. 8 bytes (64 bits) gives at most 13 base36 chars; truncate.
  const s = n.toString(36).padStart(SHORT_ID_LEN, "0");
  return s.slice(0, SHORT_ID_LEN);
}

/** True iff the input is a valid 12-char lowercase alphanumeric shortId. */
export function isValidShortId(s: unknown): s is string {
  return typeof s === "string" && SHORT_ID_PATTERN.test(s);
}
