import * as DialogPrimitive from "@radix-ui/react-dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { X } from "lucide-react"
import { useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

export interface ModalProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  loading?: boolean
  isCloseButtonShow?: boolean
  className?: string
  children?: React.ReactNode
  overlayProps?: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
  contentProps?: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
}

function preventDefault(e: Event) {
  e.preventDefault()
}

function ModalComponent({
  open,
  onOpenChange,
  loading,
  isCloseButtonShow = true,
  className,
  children,
  overlayProps,
  contentProps,
}: ModalProps) {
  const [lazyOpen, setLazyOpen] = useState(open)

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (loading) {
        return
      }

      if (value) {
        setLazyOpen(true)
      } else {
        setTimeout(() => setLazyOpen(false), 200)
      }

      onOpenChange?.(value)
    },
    [loading, onOpenChange],
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="data-[state=open]:animate-in data-[state=closed]:animate-out fixed inset-0 z-10 bg-black/60 data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          {...overlayProps}
        />
        <DialogPrimitive.Content
          onOpenAutoFocus={preventDefault}
          onCloseAutoFocus={preventDefault}
          className={cn(
            "bg-foreground scrollbar fixed left-0 right-0 bottom-0 z-10 max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-b-none rounded-t-lg border border-accent-light p-6 shadow-sm duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-0 data-[state=open]:slide-in-from-bottom-[80%] data-[state=closed]:sm:zoom-out-95 data-[state=open]:sm:zoom-in-95 data-[state=closed]:sm:slide-out-to-left-1/2 data-[state=closed]:sm:slide-out-to-top-[48%] data-[state=open]:sm:slide-in-from-left-1/2 data-[state=open]:sm:slide-in-from-top-[48%] sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-b-lg sm:bottom-auto sm:right-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
            className,
          )}
          {...contentProps}
        >
          {lazyOpen && children}
          {isCloseButtonShow && (
            <DialogPrimitive.Close asChild>
              <Button.Link size="sm" iconOnly className="absolute right-2 top-2">
                <X className="h-5 w-5" />
              </Button.Link>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function AlertModal({ children, ...rest }: ModalProps) {
  return (
    <ModalComponent className="max-w-lg" {...rest}>
      {children}
    </ModalComponent>
  )
}

export const Modal = Object.assign(ModalComponent, {
  Alert: AlertModal,
  Header: function ModalHeader({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
    return (
      <div className={cn("flex flex-col gap-1", className)} {...rest}>
        <DialogPrimitive.Title className="text-lg/6 font-semibold sm:text-base/6">
          {children}
        </DialogPrimitive.Title>
      </div>
    )
  },
  Description: function ModalDescription({ className, children, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) {
    return (
      <VisuallyHidden asChild>
        <DialogPrimitive.Description className={cn("text-sm text-secondary", className)} {...rest}>
          {children}
        </DialogPrimitive.Description>
      </VisuallyHidden>
    )
  },
  Body: function ModalBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("mt-2", className)} {...rest} />
  },
  Footer: function ModalFooter({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
    return (
      <div
        className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
        {...rest}
      />
    )
  },
})
