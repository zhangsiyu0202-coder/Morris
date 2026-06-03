import { Input, Textarea } from "@/components/ui"

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <div className="text-secondary text-sm">Workspace preferences</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="hf-card p-6">
          <h2 className="text-lg font-medium">Researcher profile</h2>
          <div className="mt-6 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium">Name</label>
            <Input disabled defaultValue="Researcher" />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Email</label>
            <Input disabled defaultValue="researcher@example.com" />
          </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">Research focus</label>
              <Textarea
                defaultValue="Product research across interview design, session quality, and evidence-backed reporting."
                rows={4}
              />
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="hf-card p-5">
            <h2 className="text-sm font-medium">Interview defaults</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="rounded-xl bg-slate-50 p-3">Anonymous participant access enabled</div>
              <div className="rounded-xl bg-slate-50 p-3">Recording and transcript capture on</div>
              <div className="rounded-xl bg-slate-50 p-3">Reports grouped by study and session batch</div>
            </div>
          </section>

          <section className="hf-card p-5">
            <h2 className="text-sm font-medium">Environment</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="rounded-xl border border-slate-200 p-3">Appwrite-backed storage when env is available</div>
              <div className="rounded-xl border border-slate-200 p-3">Copilot runtime for Moris assistant</div>
            </div>
          </section>
        </aside>
        </div>
    </div>
  )
}
