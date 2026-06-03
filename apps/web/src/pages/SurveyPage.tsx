import { Copy, MessageSquareText, MoreHorizontal, Play, Settings2, Share2, SlidersHorizontal } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button, Badge } from "@/components/ui"

const TABS = [
  { value: "editor", label: "Editor" },
  { value: "share", label: "Share" },
  { value: "sessions", label: "Sessions" },
  { value: "settings", label: "Settings" },
] as const

const SESSION_ROWS = [
  { id: "S-201", status: "Live", participant: "Anonymous participant", duration: "14m" },
  { id: "S-200", status: "Completed", participant: "Anonymous participant", duration: "27m" },
  { id: "S-199", status: "Completed", participant: "Anonymous participant", duration: "23m" },
]

export function SurveyPage() {
  const { projectId = "default", surveyId = "demo-1" } = useParams()
  const [searchParams] = useSearchParams()
  const activeTab = searchParams.get("tab") ?? "editor"
  const base = `/projects/${projectId}/surveys/${surveyId}`

  const tabContent = {
    editor: (
      <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside className="hf-card p-4">
          <div className="text-sm font-medium">Study outline</div>
          <div className="mt-4 space-y-2">
            {["Warm-up", "Current workflow", "Pain points", "Wrap-up"].map((section, index) => (
              <div key={section} className="rounded-xl border border-slate-200 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Section {index + 1}</div>
                <div className="mt-1 text-sm font-medium">{section}</div>
              </div>
            ))}
          </div>
        </aside>

        <section className="hf-card p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Question set</div>
              <div className="text-secondary mt-1 text-sm">
                Spoken questions should stay short, concrete, and easy for the interviewer to read aloud.
              </div>
            </div>
            <Button.Ghost>
              <SlidersHorizontal className="h-4 w-4" />
              Configure
            </Button.Ghost>
          </div>

          <div className="mt-6 space-y-4">
            {[
              "Tell me about the last time you used the reporting flow from start to finish.",
              "Where did you hesitate, backtrack, or need help during setup?",
              "What would make you trust the generated findings more quickly?",
            ].map((question, index) => (
              <div key={question} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm font-medium">Question {index + 1}</div>
                  <Badge color={index === 0 ? "blue" : "zinc"}>
                    {index === 0 ? "open_ended" : "follow_up"}
                  </Badge>
                </div>
                <div className="mt-3 text-sm leading-6 text-slate-700">{question}</div>
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  Probe: Ask for a concrete example, then explore why the moment stood out.
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="hf-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareText className="h-4 w-4" />
              Study notes
            </div>
            <div className="text-secondary mt-4 text-sm leading-6">
              Product research is focused on evidence quality, confidence in synthesized themes,
              and moments where researchers still leave the platform to finish analysis.
            </div>
          </div>
          <div className="hf-card p-5">
            <div className="text-sm font-medium">Coverage</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                <span>Sections</span>
                <span className="font-medium">4</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                <span>Questions</span>
                <span className="font-medium">12</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                <span>Deep probes</span>
                <span className="font-medium">5</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    ),
    share: (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="hf-card p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Share2 className="h-4 w-4" />
            Participant link
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium">https://merism.local/interviews/product-research</div>
            <div className="text-secondary mt-2 text-sm">
              Anonymous participants can join directly. No account creation required.
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button.Copy text={`https://merism.local${base}/interview`} label="Copy link" />
            <Button.Ghost>Regenerate token</Button.Ghost>
          </div>
        </section>
        <aside className="hf-card p-5">
          <div className="text-sm font-medium">Share checklist</div>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div className="rounded-xl bg-slate-50 p-3">Interview intro is written for spoken delivery.</div>
            <div className="rounded-xl bg-slate-50 p-3">Consent language has been reviewed.</div>
            <div className="rounded-xl bg-slate-50 p-3">Completion criteria are set for post-call analysis.</div>
          </div>
        </aside>
      </div>
    ),
    sessions: (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="hf-card overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="text-sm font-medium">Interview sessions</div>
          </div>
          <div className="divide-y divide-slate-200">
            {SESSION_ROWS.map((row) => (
              <div key={row.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">{row.id}</div>
                  <div className="text-secondary mt-1 text-sm">{row.participant}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge color={row.status === "Live" ? "green" : "zinc"}>{row.status}</Badge>
                  <div className="text-secondary text-sm">{row.duration}</div>
                  <Link to="/interview-preview">
                    <Button.Ghost size="sm">
                      <Play className="h-4 w-4" />
                      Preview
                    </Button.Ghost>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
        <aside className="hf-card p-5">
          <div className="text-sm font-medium">Session health</div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="font-medium">Median completion time</div>
              <div className="text-secondary mt-1">24 minutes</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="font-medium">Drop-off risk</div>
              <div className="text-secondary mt-1">Highest during technical setup questions.</div>
            </div>
          </div>
        </aside>
      </div>
    ),
    settings: (
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="hf-card p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Settings2 className="h-4 w-4" />
            Study configuration
          </div>
          <div className="mt-4 space-y-4 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 p-4">Status: Draft</div>
            <div className="rounded-xl border border-slate-200 p-4">Language: English</div>
            <div className="rounded-xl border border-slate-200 p-4">Consent required before recording</div>
          </div>
        </section>
        <section className="hf-card p-6">
          <div className="text-sm font-medium">Operational notes</div>
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            Keep structured questions minimal. Use open-ended prompts first, then let the AI
            interviewer probe for specifics when participants mention a concrete moment.
          </div>
        </section>
      </div>
    ),
  } as const

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Product research</h1>
            <Button.Link size="sm" iconOnly>
              <MoreHorizontal className="h-5 w-5" />
            </Button.Link>
          </div>
          <div className="text-secondary mt-2 text-sm">Draft · updated 12 minutes ago</div>
        </div>
        <div className="flex items-center gap-2">
          <Button.Copy
            size="md"
            text={window.location.origin + base}
            label="Copy link"
            className="order-last sm:order-first"
          />
          <Link to={`${base}?tab=editor`}>
            <Button>Edit</Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <div className="border-accent-light border-b">
          <nav className="flex items-center gap-6 text-sm font-medium text-secondary">
            {TABS.map((tab) => (
              <Link
                key={tab.value}
                to={`${base}?tab=${tab.value}`}
                className={cn(
                  "hover:text-primary text-nowrap py-3 transition-colors",
                  activeTab === tab.value &&
                    "text-primary after:bg-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full relative",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="py-6">
        {tabContent[activeTab as keyof typeof tabContent] ?? tabContent.editor}
      </div>
    </div>
  )
}
