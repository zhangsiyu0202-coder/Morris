import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@lib": path.resolve(__dirname, "./lib"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api/copilotkit": {
        target: "http://localhost:4200",
        changeOrigin: true,
      },
    },
  },
});
