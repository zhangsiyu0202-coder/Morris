"use client"

import { OptionRow } from "./option-row"

interface MultiSelectProps {
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
}

export function MultiSelect({ options, value, onChange }: MultiSelectProps) {
  function toggle(option: string) {
    if (value.includes(option)) {
      onChange(value.filter((item) => item !== option))
    } else {
      onChange([...value, option])
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {options.map((option) => (
        <OptionRow key={option} multi selected={value.includes(option)} onSelect={() => toggle(option)}>
          {option}
        </OptionRow>
      ))}
    </div>
  )
}
