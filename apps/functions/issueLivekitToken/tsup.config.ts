import { defineConfig } from "tsup";

// Bundle workspace packages into the function; keep heavy runtime SDKs external
// (Appwrite installs them from package.json dependencies at deploy time).
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  clean: true,
  noExternal: [/@merism\//],
  external: ["node-appwrite", "livekit-server-sdk"],
});
