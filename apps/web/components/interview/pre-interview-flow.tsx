"use client"

import { useState } from "react"
import { createLocalAudioTrack, MediaDeviceFailure } from "livekit-client"
import { AlertTriangle, ArrowLeft, Check, Mic, Monitor, Video } from "lucide-react"

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
 * Two interactive stages — a microphone permission prompt, then a device /
 * consent check. The first stage is the trust boundary: it acquires the
 * microphone permission via the LiveKit SDK (`createLocalAudioTrack`, which
 * mirrors livekit/components-js PreJoin) and only advances on a granted
 * permission, so by the time `onReady` fires we know the LiveKit room can
 * publish audio without surfacing a permission prompt mid-interview. Camera /
 * screenshare remain on-demand inside the room.
 */
export function PreInterviewFlow({ onReady, onBack }: PreInterviewFlowProps) {
  const [stage, setStage] = useState<Stage>("permission")
  const [consented, setConsented] = useState(false)
  const [micGranted, setMicGranted] = useState(false)

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
          <PermissionStage
            onGranted={() => {
              setMicGranted(true)
              setStage("setup")
            }}
          />
        ) : (
          <SetupStage
            micGranted={micGranted}
            consented={consented}
            onConsent={setConsented}
            onStart={() => {
              if (consented && micGranted) onReady()
            }}
          />
        )}
      </div>
    </div>
  )
}

function PermissionStage({ onGranted }: { onGranted: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleContinue() {
    setError(null)
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setError("当前浏览器不支持麦克风访问，请改用最新版 Chrome、Edge 或 Safari，并通过 https 链接访问。")
      return
    }
    setPending(true)
    // Use the SDK's createLocalAudioTrack (mirroring livekit/components-js
    // PreJoin) instead of a raw getUserMedia call. Equivalent under the hood —
    // both end up at navigator.mediaDevices.getUserMedia — but the SDK
    // normalizes browser-specific MediaStreamError names into MediaDeviceFailure
    // so we don't hard-code "NotAllowedError" / "NotReadableError" strings.
    // We stop the track immediately: the browser remembers the grant, and the
    // LiveKit room will create its own publishing track on connect.
    let track: Awaited<ReturnType<typeof createLocalAudioTrack>> | null = null
    try {
      track = await createLocalAudioTrack({})
      track.stop()
      onGranted()
    } catch (err) {
      track?.stop()
      setError(describeMediaFailure(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="w-full max-w-md rounded-xl border border-ink-200 bg-ink-0 px-10 py-10 text-center shadow-lg">
      <h2 className="mb-8 text-display-lg font-display text-ink-900">
        准备开始你的语音访谈
      </h2>

      <div className="mb-8 flex justify-center" aria-hidden="true">
        <span className="flex size-32 items-center justify-center rounded-full bg-mauve-50 text-ink-800">
          <Mic className="size-14" strokeWidth={1.5} />
        </span>
      </div>

      <p className="mb-8 px-2 font-ui text-body-sm leading-relaxed text-ink-600">
        访谈以语音进行。点击继续后，浏览器会请求你的麦克风权限；摄像头与屏幕共享在访谈中按需开启。
      </p>

      {error ? (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-lg bg-mauve-100 px-4 py-3 text-left"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-ink-900"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="font-ui text-body-sm leading-relaxed text-ink-900">{error}</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleContinue}
        disabled={pending}
        className="rounded-full bg-mauve-200 px-8 py-2.5 font-ui text-body-sm font-medium text-ink-900 shadow-sm transition-colors hover:bg-mauve-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "请求权限中…" : "继续"}
      </button>
    </section>
  )
}

function SetupStage({
  micGranted,
  consented,
  onConsent,
  onStart,
}: {
  micGranted: boolean
  consented: boolean
  onConsent: (value: boolean) => void
  onStart: () => void
}) {
  const canStart = consented && micGranted
  return (
    <section className="w-full max-w-3xl text-center">
      <h2 className="mb-2 text-display-lg font-display text-ink-900">设备与授权确认</h2>
      <p className="mb-8 font-ui text-body-sm text-ink-600">
        请确认麦克风可用，并在开始前阅读以下录制说明。
      </p>

      <div className="mx-auto mb-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <DeviceCheck
          icon={<Mic className="size-5" aria-hidden="true" />}
          label="麦克风"
          hint={micGranted ? "已就绪" : "访谈中保持开启"}
          ready={micGranted}
        />
        <DeviceCheck
          icon={<Video className="size-5" aria-hidden="true" />}
          label="摄像头"
          hint="可选，进入后开启"
        />
        <DeviceCheck
          icon={<Monitor className="size-5" aria-hidden="true" />}
          label="屏幕共享"
          hint="可选，进入后开启"
        />
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
        disabled={!canStart}
        className={`rounded-full px-8 py-2.5 font-ui text-body-sm font-medium transition-colors ${
          canStart
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
  ready,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  ready?: boolean
}) {
  return (
    <div className="relative flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-0 px-4 py-5 shadow-sm">
      {ready ? (
        <span
          className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-mauve-200 text-ink-900"
          aria-label="已就绪"
        >
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : null}
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
/**
 * Translate a `getUserMedia` / `createLocalAudioTrack` rejection into a
 * human-readable, actionable message. Uses LiveKit's `MediaDeviceFailure` to
 * normalize cross-browser error shapes (NotAllowedError vs PermissionDeniedError,
 * NotFoundError vs DevicesNotFoundError, etc.) instead of pattern-matching the
 * raw `error.name` ourselves.
 */
function describeMediaFailure(err: unknown): string {
  const failure = err instanceof Error ? MediaDeviceFailure.getFailure(err) : undefined
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return "我们需要麦克风权限才能开始访谈。请在浏览器地址栏将本网站的麦克风权限改为允许，然后重试。"
    case MediaDeviceFailure.NotFound:
      return "未检测到可用的麦克风。请确认设备已连接并重试。"
    case MediaDeviceFailure.DeviceInUse:
      return "麦克风被其它应用占用，请关闭其它视频/语音软件后重试。"
    default:
      return "无法访问麦克风，请检查设备并重试。"
  }
}
