import type { ReactNode } from "react"

export const SENTIMENT_LABEL: Record<"positive" | "neutral" | "negative", string> = {
  positive: "正面",
  neutral: "中立",
  negative: "负面",
}

export const SENTIMENT_COLOR: Record<"positive" | "neutral" | "negative", string> = {
  positive: "var(--color-positive)",
  neutral: "var(--color-neutral)",
  negative: "var(--color-negative)",
}

// Ink/mauve ramp used for distribution bars — quiet, on-brand, distinct per bar.
export const CHART_RAMP = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
]

// Render text with the given keywords underlined for emphasis.
export function highlightKeywords(text: string, keywords?: string[]): ReactNode {
  if (!keywords || keywords.length === 0) return text
  // Split on any keyword, keeping the delimiters.
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const re = new RegExp(`(${escaped.join("|")})`, "g")
  const parts = text.split(re)
  return parts.map((part, i) =>
    keywords.includes(part) ? (
      <span key={i} className="font-medium text-ink-800 underline decoration-mauve-300 underline-offset-2">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

export function SentimentTag({ sentiment }: { sentiment: "positive" | "neutral" | "negative" }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: SENTIMENT_COLOR[sentiment],
        backgroundColor: `color-mix(in oklab, ${SENTIMENT_COLOR[sentiment]} 14%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: SENTIMENT_COLOR[sentiment] }} />
      {SENTIMENT_LABEL[sentiment]}
    </span>
  )
}
