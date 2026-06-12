"use client";

/**
 * Cross-component invalidation channel for the conversations list.
 *
 * Without it, ConversationHistory and HistoryPreview each pull listConversations
 * once on mount and never re-fetch — so creating, saving (title generated),
 * or deleting a conversation in one surface leaves the other surface stale
 * until the user reloads. PostHog solves this with kea logic listeners; we
 * use a process-local EventTarget which is the lightest equivalent that
 * doesn't require a global state library.
 *
 * Usage:
 *   - Producers (after the conversation list mutates) call:
 *       invalidateConversations()
 *   - Consumers register a reload callback:
 *       useOnConversationsInvalidate(() => reload())
 *
 * Listeners are auto-cleaned by the hook on unmount.
 */

import { useEffect, useRef } from "react";

const EVENT_NAME = "merism:conversations:invalidate";

/** Only construct the EventTarget when first used (SSR-safe). */
let bus: EventTarget | null = null;
function getBus(): EventTarget {
  if (typeof window === "undefined") {
    // Server-render: return a stub. Producers won't fire on the server, and
    // consumers' useEffect runs only client-side.
    return new EventTarget();
  }
  if (!bus) bus = new EventTarget();
  return bus;
}

/**
 * Producer: call after createConversation / saveMessages onFinish (when title
 * may have changed) / deleteConversation. Returns void; cheap to call multiple
 * times in a row.
 */
export function invalidateConversations(): void {
  if (typeof window === "undefined") return;
  getBus().dispatchEvent(new Event(EVENT_NAME));
}

/**
 * Consumer hook. Registers `onInvalidate` to be called whenever
 * invalidateConversations() fires. Clean-up is automatic on unmount.
 *
 * The callback ref is updated each render so consumers don't have to memoize
 * the callback themselves — the listener stays stable.
 */
export function useOnConversationsInvalidate(onInvalidate: () => void): void {
  const cbRef = useRef(onInvalidate);
  cbRef.current = onInvalidate;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => cbRef.current();
    const target = getBus();
    target.addEventListener(EVENT_NAME, handler);
    return () => target.removeEventListener(EVENT_NAME, handler);
  }, []);
}
