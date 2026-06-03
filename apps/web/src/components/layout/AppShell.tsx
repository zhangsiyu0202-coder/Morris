import { Outlet } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import { AppSidebar } from "@/components/layout/AppSidebar"

const COLLAPSED_WIDTH = "4.25rem"
const EXPANDED_WIDTH = "17.5rem"
const EXPAND_DELAY_MS = 150
const COLLAPSE_DELAY_MS = 220
const HOVER_MEDIA_QUERY = "(hover: hover) and (pointer: fine)"

export function AppShell() {
  const [canHoverExpand, setCanHoverExpand] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const expandTimerRef = useRef<number | null>(null)
  const collapseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const mediaQuery = window.matchMedia(HOVER_MEDIA_QUERY)

    function syncHoverCapability(matches: boolean) {
      setCanHoverExpand(matches)
      setCollapsed(matches)
    }

    syncHoverCapability(mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => {
      syncHoverCapability(event.matches)
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
      if (expandTimerRef.current !== null) {
        window.clearTimeout(expandTimerRef.current)
      }
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current)
      }
    }
  }, [])

  function clearExpandTimer() {
    if (expandTimerRef.current !== null) {
      window.clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
  }

  function clearCollapseTimer() {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
  }

  function handleExpand() {
    if (!canHoverExpand) {
      return
    }

    clearCollapseTimer()
    if (!collapsed) {
      return
    }

    clearExpandTimer()
    expandTimerRef.current = window.setTimeout(() => {
      setCollapsed(false)
      expandTimerRef.current = null
    }, EXPAND_DELAY_MS)
  }

  function handleExpandImmediate() {
    if (!canHoverExpand) {
      return
    }

    clearCollapseTimer()
    clearExpandTimer()
    setCollapsed(false)
  }

  function handleCollapse() {
    if (!canHoverExpand) {
      return
    }

    clearExpandTimer()
    if (collapsed) {
      return
    }

    clearCollapseTimer()
    collapseTimerRef.current = window.setTimeout(() => {
      setCollapsed(true)
      collapseTimerRef.current = null
    }, COLLAPSE_DELAY_MS)
  }

  function handleCollapseImmediate() {
    if (!canHoverExpand) {
      return
    }

    clearExpandTimer()
    clearCollapseTimer()
    setCollapsed(true)
  }

  return (
    <div className="relative isolate flex min-h-svh w-full bg-background">
      <AppSidebar
        collapsed={collapsed}
        onExpand={handleExpand}
        onCollapse={handleCollapse}
        onExpandImmediate={handleExpandImmediate}
        onCollapseImmediate={handleCollapseImmediate}
      />
      <main
        className="bg-foreground flex min-h-svh flex-1 flex-col transition-[padding-left] duration-[180ms] ease-out lg:min-w-0"
        style={{ paddingLeft: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      >
        <div className="grow" data-slot="layout-container">
          <div className="hf-page-shell flex min-h-full flex-col" data-slot="layout-inner">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
