import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Root Vitest runner: one command executes tests across every workspace package
// (packages/*, apps/*) plus the shared property-based tests in tests/properties/.
//
// React component tests (`*.test.tsx`) are picked up alongside the pure
// `*.test.ts` files. The React plugin is loaded for the workspace so JSX/TSX
// transform works; jsdom-environment opts in via per-file pragma
// `// @vitest-environment jsdom` so logic tests stay on the fast node runtime.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web"),
      // React 19 lives only in apps/web/node_modules (not hoisted to root because
      // it's a peer dep there). Explicit alias so .test.tsx files in any package
      // resolve react/jsx-dev-runtime via apps/web's react copy.
      react: path.resolve(__dirname, "apps/web/node_modules/react"),
      "react-dom": path.resolve(__dirname, "apps/web/node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    include: [
      "tests/**/*.test.ts",
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/e2e/**"],
    passWithNoTests: true,
    testTimeout: 60_000,
    setupFiles: ["./tests/setup/jsdom-shims.ts"],
  },
});
