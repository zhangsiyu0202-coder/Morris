import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Button } from "@/components/ui"
import { cn } from "@/lib/utils"

interface ReplicaAlertDialogDemoProps {
  triggerLabel?: string
}

export function ReplicaAlertDialogDemo({
  triggerLabel = "View docs",
}: ReplicaAlertDialogDemoProps) {
  return (
    <DialogPrimitive.Root>
      <div className="replica-card mx-auto flex w-full max-w-3xl flex-col items-center gap-10 px-6 py-8 md:gap-16 md:px-8">
        <div className="flex w-full flex-col items-center gap-8">
          <div className="flex w-full flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div className="flex flex-1 flex-col gap-4">
              <h2 className="replica-title">Alert Dialog</h2>
              <p className="replica-body max-w-xl">
                A modal dialog that interrupts the user with important content and expects a
                response.
              </p>
            </div>

            <DialogPrimitive.Trigger asChild>
              <button
                type="button"
                className={cn(
                  "replica-action self-start whitespace-nowrap rounded-lg px-4 py-2 transition-all duration-200 active:scale-95 md:self-center",
                  "hover:bg-white/45 focus-visible:replica-focus-ring",
                )}
              >
                {triggerLabel}
              </button>
            </DialogPrimitive.Trigger>
          </div>

          <div className="replica-divider" />
        </div>
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 bg-slate-950/48 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="replica-dialog-title"
          aria-describedby="replica-dialog-description"
          className={cn(
            "replica-card fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),36rem)] -translate-x-1/2 -translate-y-1/2 p-6 md:p-8",
            "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200",
            "focus:outline-none",
          )}
        >
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <p className="replica-caption uppercase tracking-[0.14em]">Destructive action</p>
              <h3 id="replica-dialog-title" className="replica-title text-[1.5rem] leading-[2rem] md:text-[1.875rem] md:leading-[2.25rem]">
                Delete research library?
              </h3>
              <p id="replica-dialog-description" className="replica-body text-base md:text-lg">
                This action permanently removes interview prompts, linked sessions, and generated
                report context. The operation cannot be undone.
              </p>
            </div>

            <div className="replica-divider" />

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <DialogPrimitive.Close asChild>
                <Button.Ghost
                  className="replica-button-secondary h-11 rounded-xl px-4 text-sm font-medium transition-all duration-200 hover:bg-white/70 focus-visible:replica-focus-ring"
                >
                  Cancel
                </Button.Ghost>
              </DialogPrimitive.Close>
              <DialogPrimitive.Close asChild>
                <Button
                  className="replica-button-primary h-11 rounded-xl px-4 text-sm font-medium transition-all duration-200 focus-visible:replica-focus-ring"
                >
                  Delete permanently
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
