import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

interface SwitchProps extends ComponentProps<HTMLButtonElement> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export function Switch({ className, checked, onCheckedChange, ...rest }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "bg-brand/20 data-[state=checked]:bg-brand relative inline-flex h-6 w-10 shrink-0 cursor-pointer rounded-full p-[3px] ring-1 ring-inset ring-black/5 transition-colors sm:h-5 sm:w-8",
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "bg-foreground block size-[1.125rem] translate-x-0 rounded-full shadow ring-1 ring-black/5 transition-transform data-[state=checked]:translate-x-4 sm:size-3.5 sm:data-[state=checked]:translate-x-3",
        )}
      />
    </SwitchPrimitive.Root>
  )
}
