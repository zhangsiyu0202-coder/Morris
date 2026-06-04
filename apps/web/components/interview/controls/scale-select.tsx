"use client"

import { OptionRow } from "./option-row"

interface ScaleSelectProps {
  options: string[]
  value: string | null
  onChange: (option: string) => void
}

/**
 * Scale / rating / NPS. Rendered as the same stacked full-width rows as the
 * reference (e.g. "1 - Not at all confident" ... "5 - Extremely confident").
 * The numeric scale is encoded directly in each option string upstream.
 */
export function ScaleSelect({ options, value, onChange }: ScaleSelectProps) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2.5">
      {options.map((option) => (
        <OptionRow key={option} selected={value === option} onSelect={() => onChange(option)}>
          {option}
        </OptionRow>
      ))}
    </div>
  )
}
