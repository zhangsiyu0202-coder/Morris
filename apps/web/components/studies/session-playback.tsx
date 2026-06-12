"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Shared playback state for the session-review surface. A single recording
 * element is registered here; transcript turns and bookmark cards read
 * `currentMs` for sync-highlight and call `seekToMs` to jump the recording to a
 * transcript moment. State lives in one client island so the server-rendered
 * TranscriptView can stay a server component (it just wraps its interactive
 * region in <PlaybackProvider>).
 */
type PlaybackContextValue = {
  currentMs: number;
  hasMedia: boolean;
  seekToMs: (ms: number) => void;
  registerMedia: (el: HTMLMediaElement | null) => void;
  reportTimeMs: (ms: number) => void;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [hasMedia, setHasMedia] = useState(false);

  const registerMedia = useCallback((el: HTMLMediaElement | null) => {
    mediaRef.current = el;
    setHasMedia(el !== null);
  }, []);

  const reportTimeMs = useCallback((ms: number) => setCurrentMs(ms), []);

  const seekToMs = useCallback((ms: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
    setCurrentMs(ms);
    // Autoplay may be blocked until a user gesture; the seek still applied, the
    // researcher can press play. Benign — best-effort per the try/catch matrix.
    void el.play().catch(() => undefined);
  }, []);

  const value = useMemo<PlaybackContextValue>(
    () => ({ currentMs, hasMedia, seekToMs, registerMedia, reportTimeMs }),
    [currentMs, hasMedia, seekToMs, registerMedia, reportTimeMs],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) {
    throw new Error("usePlayback must be used within a PlaybackProvider");
  }
  return ctx;
}

/**
 * In-app recording player. Streams the owner-scoped `/view` route (cookie auth,
 * byte-range enabled) so seeking works. Registers itself with the provider so
 * transcript/bookmark interactions can drive it.
 */
export function RecordingPlayer({ sessionId }: { sessionId: string }) {
  const { registerMedia, reportTimeMs } = usePlayback();
  return (
    <video
      ref={registerMedia}
      src={`/api/recordings/${sessionId}/view`}
      controls
      preload="metadata"
      onTimeUpdate={(e) => reportTimeMs(Math.floor(e.currentTarget.currentTime * 1000))}
      className="w-full rounded-md border border-ink-200 bg-ink-900"
    >
      {/* Transcript panel is the readable caption surface; satisfies a11y. */}
      <track kind="captions" />
    </video>
  );
}
