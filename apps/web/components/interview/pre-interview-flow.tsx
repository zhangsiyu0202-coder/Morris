"use client"

import { useState } from "react"
import { ArrowLeft, Check, Mic, Monitor, Video } from "lucide-react"

interface PreInterviewFlowProps {
  /** Called once the interviewee has consented and chosen to start. */
  onReady: () => void
  /** Optional back affordance (e.g. leave the page). */
  onBack?: () => void
}

type Stage = "permission" | "setup"

/**
 * Pre-interview entry flow (visual source: docs/design/interviewer-page).
 *
 * Two interactive stages — a screen-share permission prompt, then a device /
 * consent check. Crossing the consent gate is what authorizes the room to spend
 * the one-time session slot and publish camera/screenshare, so the actual token
 * issuance and LiveKit connect are deferred until `onReady` fires.
 */
export function PreInterviewFlow({ onReady, onBack }: PreInterviewFlowProps) {
  const [stage, setStage] = useState<Stage>("permission")
  const [consented, setConsented] = useState(false)

  return (
    <div className="flex min-h-dvh flex-col bg-mauve-50">
      <header className="flex h-14 items-center justify-between border-b border-ink-200 bg-ink-0/60 px-6 backdrop-blur-sm">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="flex size-8 items-center justify-center rounded text-ink-400 transition-colors hover:bg-mauve-50"
          >
            <ArrowLeft className="size-[18px]" aria-hidden="true" />
          </button>
        ) : (
          <span className="size-8" />
        )}
        <Brand tone="light" />
        <span className="size-8" />
      </header>

      <div className="relative flex flex-1 items-center justify-center px-6 py-10">
        {stage === "permission" ? (
          <PermissionStage onContinue={() => setStage("setup")} />
        ) : (
          <SetupStage
            consented={consented}
            onConsent={setConsented}
            onStart={() => {
              if (consented) onReady()
            }}
          />
        )}
      </div>
    </div>
  )
}

function PermissionStage({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="w-full max-w-md rounded-xl border border-ink-200 bg-ink-0 px-10 py-10 text-center shadow-lg">
      <h2 className="mb-8 text-display-lg font-display text-ink-900">
        准备开始你的语音访谈
      </h2>

      <div className="mb-8 flex justify-center" aria-hidden="true">
        <span className="flex size-32 items-center justify-center rounded-full bg-mauve-50 text-ink-800">
          <Monitor className="size-14" strokeWidth={1.5} />
        </span>
      </div>

      <p className="mb-8 px-2 font-ui text-body-sm leading-relaxed text-ink-600">
        访谈以语音进行。继续后，我们会请求你的麦克风权限；你也可以在访谈中开启摄像头与屏幕共享。
      </p>

      <button
        type="button"
        onClick={onContinue}
        className="rounded-full bg-mauve-200 px-8 py-2.5 font-ui text-body-sm font-medium text-ink-900 shadow-sm transition-colors hover:bg-mauve-100"
      >
        继续
      </button>
    </section>
  )
}

function SetupStage({
  consented,
  onConsent,
  onStart,
}: {
  consented: boolean
  onConsent: (value: boolean) => void
  onStart: () => void
}) {
  return (
    <section className="w-full max-w-3xl text-center">
      <h2 className="mb-2 text-display-lg font-display text-ink-900">设备与授权确认</h2>
      <p className="mb-8 font-ui text-body-sm text-ink-600">
        请确认麦克风可用，并在开始前阅读以下录制说明。
      </p>

      <div className="mx-auto mb-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <DeviceCheck icon={<Mic className="size-5" aria-hidden="true" />} label="麦克风" hint="访谈中保持开启" />
        <DeviceCheck icon={<Video className="size-5" aria-hidden="true" />} label="摄像头" hint="可选，进入后开启" />
        <DeviceCheck icon={<Monitor className="size-5" aria-hidden="true" />} label="屏幕共享" hint="可选，进入后开启" />
      </div>

      <div className="mb-6 flex justify-center">
        <label className="inline-flex max-w-xl cursor-pointer select-none items-start gap-2.5 text-left font-ui text-body-sm text-ink-600">
          <button
            type="button"
            role="checkbox"
            aria-checked={consented}
            onClick={() => onConsent(!consented)}
            className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-xs border transition-colors ${
              consented ? "border-ink-900 bg-mauve-200" : "border-ink-200 bg-ink-0"
            }`}
          >
            {consented ? <Check className="size-3 text-ink-900" strokeWidth={3} aria-hidden="true" /> : null}
          </button>
          <span className="leading-snug">
            我已知悉并同意本次访谈过程将被录制，包括我的语音，以及我主动开启的摄像头与屏幕共享内容。
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={!consented}
        className={`rounded-full px-8 py-2.5 font-ui text-body-sm font-medium transition-colors ${
          consented
            ? "bg-mauve-200 text-ink-900 shadow-sm hover:bg-mauve-100"
            : "cursor-not-allowed bg-ink-100 text-ink-400"
        }`}
      >
        开始访谈
      </button>
    </section>
  )
}

function DeviceCheck({
  icon,
  label,
  hint,
}: {
  icon: React.ReactNode
  label: string
  hint: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-0 px-4 py-5 shadow-sm">
      <span className="flex size-10 items-center justify-center rounded-full bg-mauve-50 text-ink-800">
        {icon}
      </span>
      <span className="font-ui text-body-sm font-medium text-ink-900">{label}</span>
      <span className="font-ui text-caption text-ink-400">{hint}</span>
    </div>
  )
}

/**
 * Full-screen loading view shown while the token is issued and the room
 * connects. Driven by a real status label rather than a faked progress timer.
 */
export function InterviewLoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-mauve-50">
      <header className="flex h-14 items-center justify-center border-b border-ink-200 bg-ink-0/60 px-6 backdrop-blur-sm">
        <Brand tone="light" />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-8 flex justify-center" aria-hidden="true">
          <span className="flex size-32 items-center justify-center rounded-full bg-mauve-50 text-ink-800">
            <span className="flex items-end gap-1.5">
              <span className="h-4 w-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:0ms]" />
              <span className="h-8 w-1.5 animate-pulse rounded-full bg-ink-800 [animation-delay:150ms]" />
              <span className="h-5 w-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:300ms]" />
              <span className="h-7 w-1.5 animate-pulse rounded-full bg-ink-800 [animation-delay:450ms]" />
            </span>
          </span>
        </div>
        <h2 className="mb-3 text-display-lg font-display text-ink-900">正在准备你的访谈</h2>
        <p className="mb-8 font-ui text-body-sm text-ink-600" role="status" aria-live="polite">
          {label}
        </p>
        <p className="font-ui text-caption text-ink-400">请稍候，期间请不要刷新页面。</p>
      </div>
    </div>
  )
}

/** Shared brand lockup; `dark` variant sits on the ink-900 room shell. */
export function Brand({ tone }: { tone: "light" | "dark" }) {
  const mark = tone === "dark" ? "bg-ink-800" : "bg-ink-900"
  const text = tone === "dark" ? "text-ink-0" : "text-ink-900"
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex size-7 items-center justify-center rounded ${mark}`}>
        <span className="font-ui text-body-sm font-bold text-ink-0">M</span>
      </span>
      <span className={`font-display text-body font-semibold ${text}`}>Merism</span>
    </div>
  )
}
