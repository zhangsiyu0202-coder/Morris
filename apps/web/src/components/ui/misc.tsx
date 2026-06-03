import { cn } from "@/lib/utils"

export function Loader({ className }: ComponentProps) {
  return (
    <div className={cn("flex items-center justify-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="loader-dot bg-primary h-2 w-2 rounded-full" />
      ))}
    </div>
  )
}

export function Skeleton({ className, ...rest }: ComponentProps<HTMLDivElement>) {
  return <div className={cn("skeleton h-3.5 rounded-md", className)} {...rest} />
}

export function EmptyState({
  className,
  children,
  ...rest
}: ComponentProps<HTMLDivElement>) {
  return (
    <div className={cn("hf-empty-state flex flex-col items-center justify-center", className)} {...rest}>
      {children}
    </div>
  )
}
