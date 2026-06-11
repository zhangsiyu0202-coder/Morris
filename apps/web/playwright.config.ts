import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://localhost:3000", browserName: "chromium", headless: true },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    timeout: 180_000,
    reuseExistingServer: true,
  },
});
