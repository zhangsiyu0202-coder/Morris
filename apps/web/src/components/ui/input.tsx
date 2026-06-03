import { cn } from "@/lib/utils"
import { Eye, EyeOff } from "lucide-react"
import {
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
  forwardRef,
  useCallback,
  useRef,
  useState,
} from "react"

type InputRef = {
  clear: () => void
  submit: () => void
} | null

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "onChange"> {
  hasError?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  maxLength?: number
  onChange?: (value: string) => void
  onEnter?: () => void
}

const InputComponent = forwardRef<InputRef, InputProps>(function InputComponent(
  {
    className,
    hasError,
    leading,
    trailing,
    maxLength,
    value,
    onChange,
    onEnter,
    autoFocus,
    type,
    ...rest
  },
  ref,
) {
  const [isComposing, setIsComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const clear = useCallback(() => {
    onChange?.("")
  }, [onChange])

  const submit = useCallback(() => {
    inputRef.current?.form?.requestSubmit()
  }, [])

  if (ref) {
    if (typeof ref === "function") {
      ref({ clear, submit })
    } else {
      ref.current = { clear, submit }
    }
  }

  return (
    <div className="relative">
      {leading && (
        <div
          data-slot="leading"
          className="absolute bottom-0 left-3.5 top-0 flex items-center gap-x-2 sm:left-3"
        >
          {leading}
        </div>
      )}

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          if (!isComposing) {
            onChange?.(e.target.value)
          }
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(e) => {
          setIsComposing(false)
          onChange?.((e.target as HTMLInputElement).value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onEnter?.()
          }
        }}
        type={type}
        autoFocus={autoFocus}
        data-slot="input"
        data-type={type}
        className={cn(
          "placeholder:text-secondary block w-full appearance-none rounded-lg border bg-transparent px-3.5 py-2.5 text-base/[1.4rem] ring-0 transition-colors focus:shadow-none focus:outline-none focus:ring-0 sm:px-3 sm:py-2 sm:text-sm/[1.4rem] data-[type=number]:pr-0.5",
          hasError ? "border-error focus:border-error" : "border-input focus:border-input",
          leading && "pl-10 sm:pl-9",
          (trailing || (maxLength && maxLength > 0)) && "pr-16 sm:pr-14",
          className,
        )}
        maxLength={maxLength}
        {...rest}
      />

      {(trailing || (maxLength && maxLength > 0)) && (
        <div
          data-slot="trailing"
          className="absolute bottom-0 right-0 top-0 flex items-center gap-x-2 px-3.5 text-sm sm:px-3 text-secondary"
        >
          {trailing}
          {maxLength && maxLength > 0 && (
            <span className="pointer-events-none">
              {typeof value === "string" ? value.length : 0}/{maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  )
})

export const Input = Object.assign(InputComponent, {
  Password: forwardRef<InputRef, InputProps>(function PasswordInput(
    { className, trailing, ...rest },
    ref,
  ) {
    const [show, setShow] = useState(false)
    return (
      <InputComponent
        ref={ref}
        type={show ? "text" : "password"}
        trailing={
          <>
            <button
              type="button"
              tabIndex={-1}
              data-slot="toggle-button"
              onClick={() => setShow(!show)}
            >
              {show ? (
                <EyeOff data-slot="toggle-icon" className="h-5 w-5" />
              ) : (
                <Eye data-slot="toggle-icon" className="h-5 w-5" />
              )}
            </button>
            {trailing}
          </>
        }
        className={cn("[&_[data-slot=input]]:pr-11 sm:[&_[data-slot=input]]:pr-10", className)}
        {...rest}
      />
    )
  }),
})
