import { defineConfig } from "vitest/config";

// Root Vitest runner: one command executes tests across every workspace package
// (packages/*, apps/*) plus the shared property-based tests in tests/properties/.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/e2e/**"],
    passWithNoTests: true,
    testTimeout: 60_000,
  },
});
