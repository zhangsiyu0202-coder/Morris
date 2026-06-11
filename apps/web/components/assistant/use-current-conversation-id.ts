"use client";

/**
 * useCurrentConversationId — keeps the dock and the standalone /assistant
 * page on the same active conversation by mirroring the id through
 * `localStorage`. Without this, opening the dock, sending a message, then
 * clicking "open in new tab" would land on the welcome screen and lose the
 * thread the user just started.
 *
 * Mirrors PostHog's BindLogic-shared-state pattern (different mechanism: they
 * use a Kea logic instance keyed on tabId; we use plain localStorage because
 * we don't have a global state library).
 *
 * The standalone page is the **source of truth** when its URL contains
 * `?conversationId=<id>` — that overrides whatever's in storage. The dock
 * (which has no URL) always reads from storage, so it picks up the latest
 * conversation regardless of where the user started it.
 */

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "merism.morris.currentConversationId";

export function useCurrentConversationId(initial: string | null = null) {
  // Hydrate from localStorage on mount; initial (e.g. URL param) wins when
  // provided so /assistant?conversationId=X is canonical.
  const [conversationId, setLocal] = useState<string | null>(initial);

  useEffect(() => {
    if (initial) return; // URL provided — don't overwrite with storage
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setLocal(stored);
    } catch {
      // localStorage may be unavailable (private mode, embedded webview)
    }
  }, [initial]);

  // Persist any change back to storage so the other surface picks it up.
  // Cross-tab sync via the `storage` event (no per-tab broadcast needed).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (conversationId) {
        window.localStorage.setItem(STORAGE_KEY, conversationId);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // storage unavailable
    }
  }, [conversationId]);

  // Listen for storage events from other tabs — keeps the dock in sync if the
  // user changes conversation in the standalone page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setLocal(e.newValue ?? null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback((id: string | null) => {
    setLocal(id);
  }, []);

  return [conversationId, set] as const;
}
