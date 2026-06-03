import * as SelectPrimitive from "@radix-ui/react-select"
import { ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface SelectOption {
  label: string
  value: string
}

interface SelectProps {
  value?: string
  onChange?: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  hasError?: boolean
  clearable?: boolean
  className?: string
  disabled?: boolean
}

export function Select({ value, onChange, options, placeholder, hasError, clearable, className, disabled }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={cn(
          "inline-flex max-h-[22rem] appearance-none items-center gap-x-4 rounded-lg border bg-transparent px-3.5 py-2 text-base/[1.4rem] transition-colors sm:max-h-[20rem] sm:px-3 sm:py-1.5 sm:text-sm/[1.4rem] disabled:cursor-not-allowed disabled:bg-secondary-light",
          hasError ? "border-error" : "border-input",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="text-secondary h-5 w-5 sm:h-4 sm:w-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="bg-foreground ring-accent-light z-50 max-h-[18.5rem] rounded-xl p-1 shadow-lg outline outline-1 outline-transparent ring-1"
          position="popper"
          sideOffset={4}
        >
          <SelectPrimitive.Viewport>
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className="data-[highlighted]:bg-accent-light grid cursor-pointer grid-cols-[theme(spacing.5),1fr] gap-x-2.5 rounded-lg py-2.5 pl-2 pr-3.5 text-base/6 sm:grid-cols-[theme(spacing.4),1fr] sm:py-1.5 sm:pl-1.5 sm:pr-3 sm:text-sm/6"
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
