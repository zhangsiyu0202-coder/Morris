"use client"

import { OptionRow } from "./option-row"

interface SingleSelectProps {
  options: string[]
  value: string | null
  onChange: (option: string) => void
}

export function SingleSelect({ options, value, onChange }: SingleSelectProps) {
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
