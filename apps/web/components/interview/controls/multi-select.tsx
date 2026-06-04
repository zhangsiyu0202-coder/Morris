"use client"

import type { InterviewRuntimeOption } from "@merism/contracts"
import { OptionRow } from "./option-row"

interface MultiSelectProps {
  options: InterviewRuntimeOption[]
  value: string[]
  onChange: (next: string[]) => void
}

export function MultiSelect({ options, value, onChange }: MultiSelectProps) {
  function toggle(optionId: string) {
    if (value.includes(optionId)) {
      onChange(value.filter((id) => id !== optionId))
    } else {
      onChange([...value, optionId])
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {options.map((option) => (
        <OptionRow key={option.id} multi selected={value.includes(option.id)} onSelect={() => toggle(option.id)}>
          {option.label}
        </OptionRow>
      ))}
    </div>
  )
}
