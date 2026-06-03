import { Clock3, Link2, Mic, Plus, Sparkles } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { Button, Badge } from "@/components/ui"

const SURVEYS = [
  {
    id: "demo-1",
    name: "Product research",
    status: "Draft",
    sessions: 8,
    updatedAt: "Updated 12 minutes ago",
    summary: "Explore how users evaluate AI-generated summaries inside their research workflow.",
  },
  {
    id: "demo-2",
    name: "Onboarding interview",
    status: "Published",
    sessions: 15,
    updatedAt: "Updated 2 hours ago",
    summary: "Track first-week friction, setup blockers, and confidence signals for new researchers.",
  },
  {
    id: "demo-3",
    name: "Churn study",
    status: "Draft",
    sessions: 0,
    updatedAt: "Updated yesterday",
    summary: "Understand what caused stalled adoption and where the interview needs deeper probes.",
  },
]

const METRICS = [
  { label: "Active studies", value: "3", hint: "2 collecting responses" },
  { label: "Interview sessions", value: "23", hint: "14 completed, 3 live" },
  { label: "Published links", value: "2", hint: "Anonymous participant access" },
  { label: "Reports ready", value: "1", hint: "New synthesis this morning" },
]

const ACTIVITY = [
  "Moris suggested three follow-up probes for the onboarding study.",
  "Interview session 204 finished with a complete transcript and highlights.",
  "Share link for Product research was copied 6 times today.",
]

export function ProjectPage() {
  const { projectId = "default" } = useParams()

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-secondary text-sm">Project workspace</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Default project</h1>
          <p className="text-secondary mt-3 max-w-2xl text-sm leading-6">
            Keep study setup, interview operations, and reporting in one place instead of bouncing
            between isolated tools.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/moris">
            <Button.Ghost>
              <Sparkles className="h-4 w-4" />
              Ask Moris
            </Button.Ghost>
          </Link>
          <Button>
            <Plus className="h-4 w-4" />
            New survey
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((metric) => (
          <div key={metric.label} className="hf-card p-5">
            <div className="text-secondary text-sm">{metric.label}</div>
            <div className="mt-3 text-3xl font-semibold tracking-tight">{metric.value}</div>
            <div className="text-secondary mt-2 text-sm">{metric.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Studies</h2>
              <p className="text-secondary mt-1 text-sm">Draft, publish, and monitor interview programs.</p>
            </div>
            <Link to={`/projects/${projectId}/surveys/demo-1`}>
              <Button.Ghost>Open latest survey</Button.Ghost>
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {SURVEYS.map((survey) => (
          <Link
            key={survey.id}
            to={`/projects/${projectId}/surveys/${survey.id}`}
            className="hf-card p-5 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold tracking-tight">{survey.name}</div>
                <div className="text-secondary mt-2 text-sm leading-6">{survey.summary}</div>
              </div>
              <Badge color={survey.status === "Published" ? "green" : "zinc"}>
                {survey.status}
              </Badge>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1">
                <Mic className="h-3.5 w-3.5" />
                {survey.sessions} sessions
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1">
                <Clock3 className="h-3.5 w-3.5" />
                {survey.updatedAt}
              </div>
            </div>
          </Link>
        ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="hf-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="h-4 w-4" />
              Recruitment links
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="font-medium">Onboarding interview</div>
                <div className="text-secondary mt-1">Open to anonymous participants</div>
              </div>
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-slate-500">
                Churn study is still in draft and has no public link yet.
              </div>
            </div>
          </div>

          <div className="hf-card p-5">
            <div className="text-sm font-medium">Recent activity</div>
            <div className="mt-4 space-y-3">
              {ACTIVITY.map((item) => (
                <div key={item} className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
