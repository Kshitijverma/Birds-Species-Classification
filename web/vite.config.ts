import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { serviceWorker } from "./pwa/plugin";

export default defineConfig({
  // Relative base: the site is served from /Birds-Species-Classification/ on GitHub Pages.
  base: "./",
  plugins: [react(), serviceWorker()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
