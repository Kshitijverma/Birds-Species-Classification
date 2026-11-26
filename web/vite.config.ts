import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base: the site is served from /Birds-Species-Classification/ on GitHub Pages.
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
