import type { Preview } from "@storybook/react"
import "@copilotkit/react-core/v2/styles.css"
import "../src/styles.css"

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "replica-canvas",
      values: [
        { name: "replica-canvas", value: "#D7CFD9" },
        { name: "white", value: "#FFFFFF" },
        { name: "slate", value: "#0F172A" },
      ],
    },
    a11y: {
      test: "todo",
    },
  },
}

export default preview
