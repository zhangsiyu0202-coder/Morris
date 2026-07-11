import { describe, expect, it } from "vitest"
import { buildCallbackUrl } from "./middleware"

describe("buildCallbackUrl", () => {
  it("preserves query params for deep links", () => {
    const req = {
      nextUrl: new URL("http://localhost:3000/assistant?conversationId=conv_123&tab=history"),
    } as Parameters<typeof buildCallbackUrl>[0]

    expect(buildCallbackUrl(req)).toBe("/assistant?conversationId=conv_123&tab=history")
  })

  it("returns the pathname when there is no query", () => {
    const req = {
      nextUrl: new URL("http://localhost:3000/home"),
    } as Parameters<typeof buildCallbackUrl>[0]

    expect(buildCallbackUrl(req)).toBe("/home")
  })
})
