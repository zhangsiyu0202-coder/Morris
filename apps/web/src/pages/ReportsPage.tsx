export function ReportsPage() {
  return (
    <div className="space-y-8">
      <div>
        <div className="text-secondary text-sm">Analysis</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="text-secondary mt-3 max-w-2xl text-sm leading-6">
          Review evidence-backed themes instead of scanning raw transcripts session by session.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-4">
          {[
            {
              theme: "Researchers need proof before trusting synthesis",
              evidence:
                "Participants repeatedly asked for transcript snippets or direct quotes before using generated findings in a deck.",
            },
            {
              theme: "Setup friction shows up early in the interview",
              evidence:
                "Technical or workflow clarification questions consumed the first five minutes in most onboarding calls.",
            },
            {
              theme: "Analysis still leaves the product too late",
              evidence:
                "Researchers export notes when they need to cluster evidence manually or compare across sessions.",
            },
          ].map((item) => (
            <article key={item.theme} className="hf-card p-6">
              <div className="text-lg font-semibold">{item.theme}</div>
              <p className="text-secondary mt-3 text-sm leading-6">{item.evidence}</p>
            </article>
          ))}
        </section>

        <aside className="space-y-4">
          <div className="hf-card p-5">
            <div className="text-sm font-medium">Report status</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="font-medium">Source sessions</div>
                <div className="text-secondary mt-1">14 completed interviews</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="font-medium">Last generated</div>
                <div className="text-secondary mt-1">Today at 09:42</div>
              </div>
            </div>
          </div>

          <div className="hf-card p-5">
            <div className="text-sm font-medium">Evidence slices</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="rounded-xl border border-slate-200 p-3">5 transcript excerpts tagged as trust concerns</div>
              <div className="rounded-xl border border-slate-200 p-3">3 moments of onboarding confusion across first-time users</div>
              <div className="rounded-xl border border-slate-200 p-3">2 contradictory responses flagged for manual review</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
