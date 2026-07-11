"use client"

import { useEffect, useRef } from "react"
import type { LocalVideoTrack } from "livekit-client"
import { MicOff, VideoOff } from "lucide-react"

interface SelfCamProps {
  track: LocalVideoTrack | null
  cameraEnabled: boolean
  micEnabled: boolean
}

/**
 * Interviewee self-view. Attaches the local LiveKit camera track to a muted
 * <video>; when the camera is off it falls back to a calm placeholder. A
 * mic-off badge keeps the audio state visible since this is a voice interview.
 */
export function SelfCam({ track, cameraEnabled, micEnabled }: SelfCamProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element || !track) return
    track.attach(element)
    return () => {
      track.detach(element)
    }
  }, [track])

  const showVideo = cameraEnabled && track !== null

  return (
    <div className="relative h-full w-full overflow-hidden border-t border-ink-0/10 bg-ink-900">
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          aria-label="你的摄像头画面"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-mauve-200 text-ink-900">
            <VideoOff className="size-5" aria-hidden="true" />
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-900/60 to-transparent" />

      <div className="absolute bottom-2.5 left-3 flex items-center gap-2">
        <span className="font-ui text-caption font-medium text-ink-0/80">你</span>
      </div>

      {!micEnabled ? (
        <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border border-ink-0/40 bg-ink-900 text-ink-0">
          <MicOff className="size-3" aria-hidden="true" />
        </span>
      ) : null}
    </div>
  )
}
