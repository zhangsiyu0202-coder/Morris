import type { Meta, StoryObj } from "@storybook/react"
import { ReplicaAlertDialogDemo } from "./ReplicaAlertDialogDemo"

const meta = {
  title: "Replica/Alert Dialog",
  component: ReplicaAlertDialogDemo,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A Storybook reconstruction of the low-saturation, dual-type alert-dialog system. Inter handles the reading layer, while Inknut Antiqua is restricted to the ceremonial action trigger.",
      },
    },
  },
  args: {
    triggerLabel: "View docs",
  },
} satisfies Meta<typeof ReplicaAlertDialogDemo>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="replica-surface min-h-screen px-6 py-8 md:px-10 md:py-12">
      <ReplicaAlertDialogDemo {...args} />
    </div>
  ),
}

export const DestructiveVariant: Story = {
  args: {
    triggerLabel: "Review policy",
  },
  render: (args) => (
    <div className="replica-surface min-h-screen px-6 py-8 md:px-10 md:py-12">
      <ReplicaAlertDialogDemo {...args} />
    </div>
  ),
}
