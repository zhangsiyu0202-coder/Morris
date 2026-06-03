import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { cn } from "@/lib/utils"

interface DropdownItem {
  label: string
  value: string
  disabled?: boolean
}

interface DropdownProps {
  children: React.ReactNode
  options: DropdownItem[]
  contentProps?: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
  onClick?: (value: string) => void
}

export function Dropdown({ children, options, contentProps, onClick }: DropdownProps) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        {children}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          sideOffset={4}
          className={cn(
            "bg-foreground ring-accent-light z-50 w-max rounded-xl p-1 shadow-lg outline outline-1 outline-transparent ring-1",
            contentProps?.className,
          )}
          {...contentProps}
        >
          {options.map((opt) => (
            <DropdownMenuPrimitive.Item
              key={opt.value}
              disabled={opt.disabled}
              className={cn(
                "data-[highlighted]:bg-accent-light flex cursor-pointer items-center rounded-lg px-3.5 py-2.5 text-base/6 sm:px-3 sm:py-1.5 sm:text-sm/6",
                opt.value === "delete" && "text-error",
              )}
              onSelect={() => onClick?.(opt.value)}
            >
              {opt.label}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}
