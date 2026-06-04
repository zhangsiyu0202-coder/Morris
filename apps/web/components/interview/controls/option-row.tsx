"use client"

import type { ReactNode } from "react"

interface OptionRowProps {
  selected: boolean
  multi?: boolean
  onSelect: () => void
  children: ReactNode
}

/**
 * Single stacked option row used by single-select, multi-select and scale.
 * Mauve Quiet: white row on mauve-50 hover; selected state gains an ink-900
 * outline + mauve-100 fill (color never carries meaning alone — the filled
 * indicator does). Full-width, leading radio/checkbox indicator, label text.
 */
export function OptionRow({ selected, multi = false, onSelect, children }: OptionRowProps) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 focus-visible:ring-offset-mauve-50 ${
        selected
          ? "border-ink-900 bg-mauve-100 text-ink-900"
          : "border-ink-200 bg-ink-0 text-ink-900 hover:bg-mauve-50"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-5 shrink-0 items-center justify-center border transition-colors ${
          multi ? "rounded-[5px]" : "rounded-full"
        } ${selected ? "border-ink-900 bg-ink-900" : "border-ink-400 bg-transparent"}`}
      >
        {selected ? (
          multi ? (
            <CheckIcon />
          ) : (
            <span className="size-2 rounded-full bg-ink-0" />
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
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
