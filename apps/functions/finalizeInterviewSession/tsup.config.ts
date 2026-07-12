import { defineConfig } from "tsup";

// Appwrite Functions bundle: single main.js entry, ESM, no dts (runtime doesn't need them).
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  bundle: true,
  splitting: false,
  clean: true,
  minify: false,
  sourcemap: true,
});
