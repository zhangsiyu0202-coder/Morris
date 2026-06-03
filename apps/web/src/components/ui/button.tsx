import { cn } from "@/lib/utils"
import { Check, Copy, Loader2 } from "lucide-react"
import { type ButtonHTMLAttributes, forwardRef, useState } from "react"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "lg" | "md" | "sm"
  iconOnly?: boolean
  loading?: boolean
}

function ButtonComponent(
  { className, size = "lg", iconOnly, loading, disabled, children, type = "button", ...rest }: ButtonProps,
  ref: React.Ref<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-size={size}
      data-icon-only={iconOnly ? "" : undefined}
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center rounded-md border border-transparent bg-brand text-primary-light duration-100 focus:outline-none focus-visible:ring-0 data-[size=lg]:h-10 data-[size=md]:h-9 data-[size=sm]:h-8 data-[size=lg]:px-4 data-[size=md]:px-3.5 data-[size=sm]:px-3 data-[size=lg]:text-sm data-[size=sm]:text-xs dark:text-white data-[size=lg]:hover:bg-opacity-85 data-[size=md]:hover:bg-opacity-85 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        iconOnly && "px-0 data-[size=lg]:w-10 data-[size=md]:w-9 data-[size=sm]:w-8",
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          "flex w-full items-center justify-center gap-x-2",
          loading && "[&_[data-slot=button]]:opacity-0",
        )}
      >
        <span data-slot="button">{children}</span>
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        )}
      </div>
    </button>
  )
}

function GhostButton(
  { className, size = "lg", iconOnly, loading, disabled, children, ...rest }: ButtonProps,
  ref: React.Ref<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      data-size={size}
      data-icon-only={iconOnly ? "" : undefined}
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center rounded-md border border-input bg-foreground text-primary duration-100 hover:bg-accent-light focus:outline-none focus-visible:ring-0 data-[size=lg]:h-10 data-[size=md]:h-9 data-[size=sm]:h-8 data-[size=lg]:px-4 data-[size=md]:px-3.5 data-[size=sm]:px-3 data-[size=md]:text-sm data-[size=md]:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        iconOnly && "px-0 data-[size=lg]:w-10 data-[size=md]:w-9 data-[size=sm]:w-8",
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          "flex w-full items-center justify-center gap-x-2",
          loading && "[&_[data-slot=button]]:opacity-0",
        )}
      >
        <span data-slot="button">{children}</span>
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        )}
      </div>
    </button>
  )
}

const GhostButtonComponent = forwardRef(GhostButton)

function LinkButton(
  { className, size = "lg", iconOnly, loading, disabled, children, ...rest }: ButtonProps,
  ref: React.Ref<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      data-size={size}
      data-icon-only={iconOnly ? "" : undefined}
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-primary duration-100 hover:bg-accent-light focus:outline-none focus-visible:ring-0 aria-expanded:bg-accent-light data-[size=lg]:h-10 data-[size=md]:h-9 data-[size=sm]:h-8 data-[size=lg]:px-4 data-[size=md]:px-3.5 data-[size=sm]:px-3 data-[size=md]:text-sm data-[size=md]:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        iconOnly && "px-0 data-[size=lg]:w-10 data-[size=md]:w-9 data-[size=sm]:w-8",
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          "flex w-full items-center justify-center gap-x-2",
          loading && "[&_[data-slot=button]]:opacity-0",
        )}
      >
        <span data-slot="button">{children}</span>
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        )}
      </div>
    </button>
  )
}

const LinkButtonComponent = forwardRef(LinkButton)

interface CopyButtonProps extends Omit<ButtonProps, "children"> {
  text: string
  label?: string
  icon?: React.ReactNode
}

function CopyButton(
  { text, label, icon, size = "md", ...rest }: CopyButtonProps,
  ref: React.Ref<HTMLButtonElement>,
) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const displayIcon = copied ? <Check className="h-4 w-4" /> : (icon ?? <Copy className="h-4 w-4" />)

  return (
    <GhostButtonComponent
      ref={ref}
      size={size}
      onClick={handleCopy}
      {...rest}
    >
      {displayIcon}
      {label && <span>{label}</span>}
    </GhostButtonComponent>
  )
}

export const Button = Object.assign(forwardRef(ButtonComponent), {
  Ghost: GhostButtonComponent,
  Link: LinkButtonComponent,
  Copy: forwardRef(CopyButton),
})
