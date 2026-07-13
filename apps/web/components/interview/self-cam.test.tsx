// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { LocalVideoTrack } from "livekit-client"
import { SelfCam } from "./self-cam"

afterEach(() => {
  cleanup()
})

describe("SelfCam", () => {
  it("attaches an unchanged track to the newly mounted video when the camera is re-enabled", () => {
    const track = {
      attach: vi.fn(),
      detach: vi.fn(),
    } as unknown as LocalVideoTrack

    const { rerender } = render(
      <SelfCam track={track} cameraEnabled micEnabled />,
    )

    const firstVideo = screen.getByLabelText("你的摄像头画面")
    expect(track.attach).toHaveBeenCalledWith(firstVideo)

    rerender(<SelfCam track={track} cameraEnabled={false} micEnabled />)

    expect(track.detach).toHaveBeenCalledWith(firstVideo)

    rerender(<SelfCam track={track} cameraEnabled micEnabled />)

    const secondVideo = screen.getByLabelText("你的摄像头画面")
    expect(secondVideo).not.toBe(firstVideo)
    expect(track.attach).toHaveBeenLastCalledWith(secondVideo)
    expect(track.attach).toHaveBeenCalledTimes(2)
  })
})
