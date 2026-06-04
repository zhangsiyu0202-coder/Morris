"use client"

import { useEffect, useRef, useState } from "react"
import { Expand, ImageOff, X } from "lucide-react"
import type { Stimulus } from "@merism/contracts"

interface StimulusDisplayProps {
  stimulus: Stimulus
}

/**
 * The stimulus panel that appears alongside a question whenever the agent
 * attaches one (concept / ad / copy testing). It mirrors the reference layout:
 * a bordered panel with an "Expand" affordance, sitting next to the question.
 *
 * Three stimulus types are supported, matching the contract:
 *   - image : rendered with a loading skeleton + broken-image fallback
 *   - video : native <video> player (durationMs is informational)
 *   - text  : typeset copy shown as the material under evaluation
 */
export function StimulusDisplay({ stimulus }: StimulusDisplayProps) {
  const [expanded, setExpanded] = useState(false)

  const canExpand = stimulus.type === "image" || stimulus.type === "text"

  return (
    <div className="flex flex-col rounded-lg border border-ink-200 bg-ink-0 shadow-sm">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
        <span className="text-caption font-medium uppercase tracking-wider text-ink-400">
          评估素材
        </span>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-caption font-medium text-ink-600 transition-colors hover:bg-mauve-50"
          >
            <Expand className="size-3.5" aria-hidden="true" />
            放大查看
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <StimulusBody stimulus={stimulus} />
      </div>

      {expanded ? (
        <StimulusLightbox stimulus={stimulus} onClose={() => setExpanded(false)} />
      ) : null}
    </div>
  )
}

/** Inner renderer shared by the inline panel and the expanded lightbox. */
function StimulusBody({ stimulus, large = false }: { stimulus: Stimulus; large?: boolean }) {
  if (stimulus.type === "text") {
    return (
      <div
        className={`w-full whitespace-pre-wrap text-pretty font-reading text-ink-800 ${
          large ? "text-body-lg" : "text-body"
        }`}
      >
        {stimulus.text ?? ""}
      </div>
    )
  }

  if (stimulus.type === "video") {
    if (!stimulus.url) return <StimulusMissing label="视频不可用" />
    return (
      <video
        controls
        src={stimulus.url}
        className="max-h-full w-full rounded-sm"
        aria-label="访谈刺激物视频"
      >
        你的浏览器不支持视频播放。
      </video>
    )
  }

  // image
  return <StimulusImage url={stimulus.url} large={large} />
}

function StimulusImage({ url, large }: { url?: string; large?: boolean }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")

  if (!url) return <StimulusMissing label="图片不可用" />

  return (
    <div className="relative flex w-full items-center justify-center">
      {status === "loading" ? (
        <div className="absolute inset-0 animate-pulse rounded-sm bg-mauve-50" aria-hidden="true" />
      ) : null}
      {status === "error" ? (
        <StimulusMissing label="图片加载失败" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url || "/placeholder.svg"}
          alt="访谈中展示的评估素材"
          crossOrigin="anonymous"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={`h-auto max-w-full rounded-sm object-contain ${
            large ? "w-full" : "w-auto max-h-[60vh]"
          } ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  )
}

function StimulusMissing({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-ink-400">
      <ImageOff className="size-6" aria-hidden="true" />
      <p className="text-body-sm">{label}</p>
    </div>
  )
}

/** Fullscreen view, built on the native <dialog> so it needs no new deps. */
function StimulusLightbox({ stimulus, onClose }: { stimulus: Stimulus; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      className="m-auto flex max-h-[90vh] w-[min(92vw,960px)] flex-col overflow-hidden rounded-lg bg-ink-0 p-0 shadow-lg backdrop:bg-ink-900/60"
    >
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <span className="text-caption font-medium uppercase tracking-wider text-ink-400">
          评估素材
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-caption font-medium text-ink-600 transition-colors hover:bg-mauve-50"
        >
          <X className="size-3.5" aria-hidden="true" />
          关闭
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-5">
        <StimulusBody stimulus={stimulus} large />
      </div>
    </dialog>
  )
}
