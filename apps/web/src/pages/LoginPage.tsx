import { Link } from "react-router-dom"
import { Button, Input } from "@/components/ui"

export function LoginPage() {
  return (
    <main className="bg-background min-h-screen px-6 py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl gap-8 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="hf-card flex flex-col justify-between p-8">
          <div>
            <div className="flex items-center gap-3">
              <div className="bg-primary flex h-10 w-10 items-center justify-center rounded-xl">
                <span className="text-primary-light text-sm font-bold">M</span>
              </div>
              <div>
                <div className="text-lg font-semibold">MerismV2</div>
                <div className="text-secondary text-sm">Qualitative voice research workspace</div>
              </div>
            </div>

            <div className="mt-12">
              <h1 className="text-3xl font-semibold tracking-tight">Researcher sign in</h1>
              <p className="text-secondary mt-3 text-sm leading-6">
                Access studies, monitor active sessions, and review analysis in one workspace.
              </p>
            </div>

            <form className="mt-8 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input defaultValue="researcher@example.com" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <Input.Password defaultValue="password" />
              </div>
              <Link to="/dashboard" className="block">
                <Button className="w-full">Continue to workspace</Button>
              </Link>
            </form>
          </div>

          <div className="hf-card-muted mt-8 p-5">
            <div className="text-sm font-medium">This demo includes</div>
            <div className="text-secondary mt-3 grid gap-3 text-sm">
              <div>Project dashboard with active studies and interview health.</div>
              <div>Survey workspace for authoring, sharing, sessions, and study settings.</div>
              <div>Reports and Moris assistant surfaces in the same app shell.</div>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-between rounded-[28px] border border-slate-200 bg-slate-900 px-8 py-8 text-slate-50 shadow-sm">
          <div className="max-w-xl">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
              Research operations
            </div>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">
              Run voice interviews without leaving the study workspace.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Design studies, launch anonymous interview links, and move from raw evidence to
              structured findings with less dashboard clutter.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-2xl font-semibold">14</div>
              <div className="mt-2 text-sm text-slate-300">Interviews completed this week</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-2xl font-semibold">3</div>
              <div className="mt-2 text-sm text-slate-300">Studies currently recruiting</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-2xl font-semibold">5</div>
              <div className="mt-2 text-sm text-slate-300">Themes extracted in latest report</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
