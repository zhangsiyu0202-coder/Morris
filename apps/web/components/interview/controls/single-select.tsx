"use client"

import type { InterviewRuntimeOption } from "@merism/contracts"
import { OptionRow } from "./option-row"

interface SingleSelectProps {
  options: InterviewRuntimeOption[]
  value: string | null
  onChange: (optionId: string) => void
}

export function SingleSelect({ options, value, onChange }: SingleSelectProps) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2.5">
      {options.map((option) => (
        <OptionRow key={option.id} selected={value === option.id} onSelect={() => onChange(option.id)}>
          {option.label}
        </OptionRow>
      ))}
    </div>
  )
}
