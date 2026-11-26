import { test as base, expect } from "@playwright/test";
import { PNG } from "pngjs";

/**
 * A page that fails the test on any console error or uncaught exception, and that
 * stubs the Google Fonts stylesheet so the tests don't depend on a third-party server.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text()} (${msg.location().url})`);
      });
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
        route.fulfill({ status: 200, contentType: "text/css", body: "" }),
      );
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** A PNG of uniform random noise, the same every run. */
export function noisePng(size = 256): Buffer {
  const png = new PNG({ width: size, height: size });
  let seed = 16;
  for (let i = 0; i < png.data.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    png.data[i] = i % 4 === 3 ? 255 : seed >>> 24;
  }
  return PNG.sync.write(png);
}
