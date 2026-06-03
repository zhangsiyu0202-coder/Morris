import type { Meta, StoryObj } from "@storybook/react"

function ColorSwatch({
  name,
  value,
  note,
}: {
  name: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-2xl border border-[rgba(var(--hf-replica-border))] bg-white/35 p-4">
      <div
        className="h-20 rounded-xl border border-black/5"
        style={{ backgroundColor: value }}
      />
      <div className="mt-4 text-sm font-semibold text-[rgba(var(--hf-replica-ink-primary))]">
        {name}
      </div>
      <div className="mt-1 font-mono text-xs text-[rgba(var(--hf-replica-ink-secondary))]">
        {value}
      </div>
      <div className="mt-2 text-sm leading-6 text-[rgba(var(--hf-replica-ink-secondary))]">
        {note}
      </div>
    </div>
  )
}

function ReplicaFoundationsShowcase() {
  return (
    <div className="replica-surface min-h-screen px-6 py-8 md:px-10 md:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="replica-card p-6 md:p-8">
          <div className="flex flex-col gap-3">
            <p className="replica-caption uppercase tracking-[0.14em]">Foundations</p>
            <h1 className="replica-title">Low-saturation engineering aesthetic</h1>
            <p className="replica-body max-w-3xl">
              Morandi canvas tones, stone-blue ink, Inter for utility, and Inknut Antiqua for
              ceremonial action. This story locks the system into reusable front-end tokens.
            </p>
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="replica-card p-6 md:p-8">
            <div className="replica-caption uppercase tracking-[0.14em]">Palette</div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <ColorSwatch
                name="Canvas Background"
                value="#D7CFD9"
                note="High-lightness Morandi pink-violet gray."
              />
              <ColorSwatch
                name="Primary Ink"
                value="#0F172A"
                note="Slate 900 with enough depth for APCA-safe reading."
              />
              <ColorSwatch
                name="Secondary Ink"
                value="#475569"
                note="Slate 600 for descriptive copy and lower reading pressure."
              />
              <ColorSwatch
                name="Border Hairline"
                value="#E2E8F0"
                note="Thin structural separation with minimal visual noise."
              />
            </div>
          </div>

          <div className="replica-card p-6 md:p-8">
            <div className="replica-caption uppercase tracking-[0.14em]">Typography</div>
            <div className="mt-5 flex flex-col gap-6">
              <div>
                <div className="replica-caption">Inter / utility system</div>
                <div className="replica-title mt-2">Alert Dialog</div>
                <p className="replica-body mt-3">
                  Use Inter for the main reading plane, with 1.4 to 1.5 line-height and optical
                  feature settings enabled for screen clarity.
                </p>
              </div>
              <div className="replica-divider" />
              <div>
                <div className="replica-caption">Inknut Antiqua / ceremonial anchor</div>
                <button type="button" className="replica-action mt-3">
                  View docs
                </button>
                <p className="replica-body mt-3 text-base">
                  Keep it above 12px, underline with offset, and reserve it for a single strong
                  action per surface.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

const meta = {
  title: "Replica/Foundations",
  component: ReplicaFoundationsShowcase,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ReplicaFoundationsShowcase>

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
