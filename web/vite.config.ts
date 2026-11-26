import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { serviceWorker } from "./pwa/plugin";

export default defineConfig({
  // Relative base: the site is served from /Birds-Species-Classification/ on GitHub Pages.
  base: "./",
  plugins: [react(), serviceWorker()],
  // The model runs in a module worker (src/model.worker.ts); ES output keeps it one chunk
  // that loads ONNX Runtime's wasm relative to itself, like the page did.
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
