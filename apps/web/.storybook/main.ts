import path from "node:path"
import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  async viteFinal(config) {
    config.resolve ??= {}
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@": path.resolve(__dirname, "../src"),
      "@lib": path.resolve(__dirname, "../lib"),
    }
    return config
  },
}

export default config
