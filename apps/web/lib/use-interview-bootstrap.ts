"use client"

import { useEffect, useRef, useState } from "react"
import { issueLivekitToken } from "./issue-token"

export type BootstrapPhase = "idle" | "issuing" | "ready" | "error"

export interface BootstrapResult {
  phase: BootstrapPhase
  connectArgs: { serverUrl: string; token: string } | null
  error: string | null
}

/**
 * Exchanges the interview link token for a LiveKit room token exactly once.
 *
 * Token issuance claims a single-use session slot server-side, so it must not
 * run more than once — and it must not run until the interviewee has actively
 * consented and chosen to start. The caller flips `enabled` to true only after
 * the pre-interview consent flow completes; before that the hook stays idle and
 * the one-time session slot is never spent on a page that is merely open.
 *
 * This is an imperative external-system action (not render data), so a
 * ref-guarded effect is the correct pattern — re-runs are blocked even under
 * StrictMode double-invocation.
 */
export function useInterviewBootstrap(
  linkToken: string | null,
  enabled: boolean,
): BootstrapResult {
  const [phase, setPhase] = useState<BootstrapPhase>("idle")
  const [connectArgs, setConnectArgs] = useState<BootstrapResult["connectArgs"]>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled || !linkToken || startedRef.current) return
    startedRef.current = true

    let cancelled = false
    setPhase("issuing")
    issueLivekitToken(linkToken)
      .then((res) => {
        if (cancelled) return
        setConnectArgs({ serverUrl: res.livekitUrl, token: res.token })
        setPhase("ready")
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "token_request_failed")
        setPhase("error")
      })

    return () => {
      cancelled = true
    }
  }, [enabled, linkToken])

  return { phase, connectArgs, error }
}
