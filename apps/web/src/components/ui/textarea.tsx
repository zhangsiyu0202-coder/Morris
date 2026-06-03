import { cn } from "@/lib/utils"
import { type TextareaHTMLAttributes, forwardRef } from "react"

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, hasError, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "placeholder:text-secondary scrollbar block w-full appearance-none rounded-lg border bg-transparent px-3.5 py-2.5 text-base/[1.4rem] transition-colors focus:shadow-none focus:outline-none focus:ring-0 sm:px-3 sm:py-2 sm:text-sm/[1.4rem]",
        hasError ? "border-error focus:border-error" : "border-input focus:border-input",
        className,
      )}
      {...rest}
    />
  )
})
