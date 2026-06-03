import { cn } from "@/lib/utils"

interface BadgeProps extends ComponentProps {
  color?: "zinc" | "red" | "blue" | "green" | "amber" | "purple" | "teal" | "pink"
}

const colorMap: Record<string, string> = {
  zinc: "bg-zinc-600/10 text-secondary",
  red: "bg-red-500/15 text-red-700",
  blue: "bg-blue-500/15 text-blue-700",
  green: "bg-green-500/15 text-green-700",
  amber: "bg-amber-400/20 text-amber-700",
  purple: "bg-purple-500/15 text-purple-700",
  teal: "bg-teal-500/15 text-teal-700",
  pink: "bg-pink-500/15 text-pink-700",
}

export function Badge({ className, color = "zinc", children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-x-1.5 rounded-md px-1.5 py-0.5 text-sm/5 font-medium sm:text-xs/5",
        colorMap[color],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
