import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke and accessibility tests against the production build, served the way
// GitHub Pages serves it: under /Birds-Species-Classification/. Run `npm run build` first.
const port = Number(process.env.E2E_PORT ?? 4173);
const base = "/Birds-Species-Classification/";

export default defineConfig({
  testDir: "e2e",
  // Identifying a photo loads a 23 MB model and runs it in WASM, which takes a few seconds in CI.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}${base}`,
    // The service worker caches the site and model; it's tested in pwa.test.ts, not here.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Lets a local run use an already-downloaded Chromium instead of the pinned one.
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: `npx vite preview --base ${base} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}${base}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
