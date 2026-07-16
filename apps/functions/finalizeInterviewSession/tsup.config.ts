import { defineConfig } from "tsup";

// Appwrite Function bundle: a single runtime entry with no declarations.
export default defineConfig({
  entry: ["src/main.ts"],
  // `node-appwrite` contains CommonJS dependencies with dynamic require.
  // Appwrite executes this self-contained bundle as CommonJS.
  format: ["cjs"],
  target: "node20",
  outDir: "dist",
  bundle: true,
  splitting: false,
  // Appwrite's build container may not have registry access in local Docker.
  // Keep this Function deployable by embedding its only runtime dependency.
  noExternal: ["node-appwrite"],
  outExtension: () => ({ js: ".cjs" }),
  clean: true,
  minify: false,
  sourcemap: true,
});
