"use client"

import type { InterviewResponseMode } from "@merism/contracts"
import { SingleSelect } from "./controls/single-select"
import { MultiSelect } from "./controls/multi-select"
import { ScaleSelect } from "./controls/scale-select"
import { RankingSelect } from "./controls/ranking-select"
import { VoiceOnly } from "./controls/voice-only"

/** Local, mode-agnostic draft of the respondent's UI selection. */
export interface ResponseDraft {
  single: string | null
  multi: string[]
  scale: string | null
  ranking: string[]
}

export const emptyDraft = (options: string[]): ResponseDraft => ({
  single: null,
  multi: [],
  scale: null,
  ranking: options,
})

interface ResponseControlProps {
  mode: InterviewResponseMode
  options: string[]
  draft: ResponseDraft
  onChange: (next: ResponseDraft) => void
}

/**
 * Pure dispatcher: routes a runtime question's responseMode to the matching
 * control. Each control is the optional UI layer on top of voice — the
 * respondent can always just speak instead.
 */
export function ResponseControl({ mode, options, draft, onChange }: ResponseControlProps) {
  switch (mode) {
    case "single_select":
      return (
        <SingleSelect
          options={options}
          value={draft.single}
          onChange={(single) => onChange({ ...draft, single })}
        />
      )
    case "multi_select":
      return (
        <MultiSelect
          options={options}
          value={draft.multi}
          onChange={(multi) => onChange({ ...draft, multi })}
        />
      )
    case "scale":
      return (
        <ScaleSelect
          options={options}
          value={draft.scale}
          onChange={(scale) => onChange({ ...draft, scale })}
        />
      )
    case "ranking":
      return (
        <RankingSelect value={draft.ranking} onChange={(ranking) => onChange({ ...draft, ranking })} />
      )
    case "voice_only":
    default:
      return <VoiceOnly />
  }
}

/** Whether the current draft carries a UI selection worth submitting. */
export function hasSelection(mode: InterviewResponseMode, draft: ResponseDraft): boolean {
  switch (mode) {
    case "single_select":
      return draft.single !== null
    case "multi_select":
      return draft.multi.length > 0
    case "scale":
      return draft.scale !== null
    case "ranking":
      return draft.ranking.length > 0
    case "voice_only":
    default:
      return false
  }
}
