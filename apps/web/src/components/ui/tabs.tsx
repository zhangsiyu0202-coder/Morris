import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface TabsProps {
  tabs: { value: string; label: string; content: ReactNode }[]
  defaultTab?: string
  onChange?: (value: string) => void
  className?: string
}

export function Tabs({ tabs, defaultTab, onChange, className }: TabsProps) {
  return (
    <TabsPrimitive.Root defaultValue={defaultTab} onValueChange={onChange}>
      <TabsPrimitive.List
        className={cn(
          "border-accent-light text-secondary flex h-12 items-center justify-start gap-0 border-b px-4 text-sm font-medium",
          className,
        )}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="text-secondary data-[state=active]:text-primary relative pb-3 pr-6 pt-3 transition-colors hover:text-primary"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.value} value={tab.value} className="pt-4">
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  )
}

interface SegmentedTabsProps {
  tabs: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function SegmentedTabs({ tabs, value, onChange, className }: SegmentedTabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange}>
      <TabsPrimitive.List
        className={cn(
          "bg-accent-light text-secondary grid h-10 w-full rounded-md p-1",
          className,
        )}
        style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="text-secondary data-[state=active]:bg-foreground data-[state=active]:text-primary flex items-center justify-center rounded-md px-3 py-1 text-sm/6 font-medium transition-colors hover:text-primary"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}
