"use client"

import { useEffect, useState } from "react"
import {
  Clock,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Video,
  VideoOff,
} from "lucide-react"
import type { InterviewAnswerPayload } from "@merism/contracts"
import type { LiveInterviewSession } from "@/lib/use-live-interview"
import { Brand } from "./pre-interview-flow"
import { ConversationPanel } from "./conversation-panel"
import { QuestionStage } from "./question-stage"
import { SelfCam } from "./self-cam"

interface InterviewRoomShellProps {
  session: LiveInterviewSession
}

/**
 * Dark two-pane interview room shell (visual source: docs/design/interviewer-page).
 *
 * Top bar: brand + client-side elapsed timer + derived progress. Left pane:
 * live transcript over the camera self-view. Right pane: the existing
 * contract-driven question stage on a light surface. Bottom bar: media toggles
 * only — push-to-talk is intentionally dropped (voice is always live).
 */
export function InterviewRoomShell({ session }: InterviewRoomShellProps) {
  const elapsed = useElapsedSeconds()
  const reconnecting = session.phase === "reconnecting"

  async function handleSubmit(answer: InterviewAnswerPayload) {
    await session.submitAnswer(answer)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-900">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-0/10 bg-ink-900 px-6">
        <div className="flex items-center gap-4">
          <Brand tone="dark" />
          <span className="flex items-center gap-1.5 text-ink-400">
            <Clock className="size-3.5" aria-hidden="true" />
            <span className="font-data text-caption">{formatTime(elapsed)}</span>
          </span>
        </div>

        <div className="mx-12 flex max-w-xs flex-1 items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-0/10">
            <div
              className="h-full rounded-full bg-mauve-200 transition-all duration-1000"
              style={{ width: `${Math.round((session.progress ?? 0) * 100)}%` }}
            />
          </div>
          {session.progress !== null ? (
            <span className="shrink-0 font-data text-caption text-ink-400">
              {Math.round(session.progress * 100)}%
            </span>
          ) : null}
        </div>
      </header>

      {reconnecting ? (
        <p
          className="bg-ink-800 px-6 py-2 text-center font-ui text-caption text-ink-100"
          role="status"
          aria-live="polite"
        >
          网络波动，正在重新连接…
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-ink-0/10">
          <div className="flex min-h-0 basis-2/3 flex-col">
            <ConversationPanel transcript={session.transcript} />
          </div>
          <div className="min-h-0 basis-1/3">
            <SelfCam
              track={session.localVideoTrack}
              cameraEnabled={session.media.cameraEnabled}
              micEnabled={session.media.micEnabled}
            />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto bg-mauve-50 px-6 py-8 sm:px-10">
          {session.question ? (
            <QuestionStage question={session.question} onSubmit={handleSubmit} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-ink-100 text-ink-400">
                <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              </span>
              <p className="font-ui text-body-sm text-ink-400">访谈员正在准备问题…</p>
            </div>
          )}
        </main>
      </div>

      <footer className="flex h-20 shrink-0 items-center border-t border-ink-0/10 bg-ink-900 px-8">
        <div className="flex items-center gap-3">
          <MediaToggle
            enabled={session.media.micEnabled}
            onClick={() => session.setMicrophoneEnabled(!session.media.micEnabled)}
            onIcon={<Mic className="size-5" aria-hidden="true" />}
            offIcon={<MicOff className="size-5" aria-hidden="true" />}
            label="麦克风"
          />
          <MediaToggle
            enabled={session.media.cameraEnabled}
            onClick={() => session.setCameraEnabled(!session.media.cameraEnabled)}
            onIcon={<Video className="size-5" aria-hidden="true" />}
            offIcon={<VideoOff className="size-5" aria-hidden="true" />}
            label="摄像头"
          />
          <MediaToggle
            enabled={session.media.screenShareEnabled}
            onClick={() => session.setScreenShareEnabled(!session.media.screenShareEnabled)}
            onIcon={<Monitor className="size-5" aria-hidden="true" />}
            offIcon={<MonitorOff className="size-5" aria-hidden="true" />}
            label="屏幕共享"
          />
        </div>
      </footer>
    </div>
  )
}

interface MediaToggleProps {
  enabled: boolean
  onClick: () => void
  onIcon: React.ReactNode
  offIcon: React.ReactNode
  label: string
}

/**
 * Round media toggle. State is communicated by fill + icon (Mic vs MicOff),
 * never by color — enabled is the signature mauve, off is a quiet ink surface.
 */
function MediaToggle({ enabled, onClick, onIcon, offIcon, label }: MediaToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={enabled}
      aria-label={`${label}${enabled ? "（已开启）" : "（已关闭）"}`}
      title={label}
      className={`flex size-12 items-center justify-center rounded-full transition-colors ${
        enabled
          ? "bg-mauve-200 text-ink-900 hover:bg-mauve-100"
          : "border border-ink-0/10 bg-ink-800 text-ink-400 hover:text-ink-100"
      }`}
    >
      {enabled ? onIcon : offIcon}
    </button>
  )
}

function useElapsedSeconds(): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return elapsed
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0")
  const seconds = (totalSeconds % 60).toString().padStart(2, "0")
  return `${minutes}:${seconds}`
}

