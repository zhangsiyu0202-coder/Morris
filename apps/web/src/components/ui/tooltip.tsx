import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

interface TooltipProps {
  label: string
  children: React.ReactNode
  contentProps?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
  delayDuration?: number
}

export function Tooltip({ label, children, contentProps, delayDuration = 300 }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={4}
            className={cn(
              "bg-primary text-primary-light z-50 rounded-md px-2.5 py-1.5 text-sm sm:py-1 sm:text-xs",
              contentProps?.className,
            )}
            {...contentProps}
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-primary" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
