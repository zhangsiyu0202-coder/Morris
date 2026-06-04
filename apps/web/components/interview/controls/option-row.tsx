"use client"

import type { ReactNode } from "react"

interface OptionRowProps {
  selected: boolean
  multi?: boolean
  onSelect: () => void
  children: ReactNode
}

/**
 * Single stacked option row used by single-select, multi-select and scale
 * controls. Matches the reference layout: full-width row, leading
 * radio/checkbox indicator, label text, subtle hover + selected states.
 */
export function OptionRow({ selected, multi = false, onSelect, children }: OptionRowProps) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/8 text-foreground"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/60"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-5 shrink-0 items-center justify-center border transition-colors ${
          multi ? "rounded-[5px]" : "rounded-full"
        } ${selected ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
      >
        {selected ? (
          multi ? (
            <CheckIcon />
          ) : (
            <span className="size-2 rounded-full bg-primary-foreground" />
          )
        ) : null}
      </span>
      <span className="text-body-sm leading-relaxed">{children}</span>
    </button>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 6.2L4.8 8.5L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary-foreground"
      />
    </svg>
  )
}
