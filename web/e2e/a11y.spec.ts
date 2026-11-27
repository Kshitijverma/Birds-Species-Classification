import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { KEY_V2, storedShape, type Sighting } from "../src/notebookData";
import { expect, noisePng, test } from "./fixtures";

// A 1x1 PNG, standing in for a Sighting's thumbnail.
const THUMB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAJbAPx0lyuMwAAAABJRU5ErkJggg==";
const SIGHTING: Sighting = {
  species: "Blue Jay",
  firstSeen: "2026-05-01T09:00:00.000Z",
  lastSeen: "2026-05-03T09:00:00.000Z",
  count: 2,
  thumb: THUMB,
  note: "Two of them squabbling at the feeder.",
  place: "Back garden",
};

async function withSighting(page: Page) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [KEY_V2, JSON.stringify(storedShape([SIGHTING]))]);
}

async function identifyExample(page: Page, species: string) {
  await page.getByRole("button", { name: `Try the example photo: ${species}` }).click();
  await expect(page.locator("article.card h2.species")).toHaveText(species, { timeout: 60_000 });
}

/** Each page (and a few states of them), and what to wait for before it's fully drawn. */
const PAGES: { name: string; path: string; setup?: (page: Page) => Promise<void>; ready: (page: Page) => Promise<void> }[] = [
  {
    name: "identify",
    path: "#/",
    ready: (page) => expect(page.locator(".examples img").first()).toBeVisible(),
  },
  {
    name: "identify, with a named Verdict",
    path: "#/",
    ready: async (page) => {
      await identifyExample(page, "Northern Cardinal");
      await expect(page.getByRole("button", { name: "Share card" })).toBeEnabled();
    },
  },
  {
    name: "identify, cropping",
    path: "#/",
    ready: async (page) => {
      await identifyExample(page, "Northern Cardinal");
      await page.getByRole("button", { name: "Crop to the bird" }).click();
      await expect(page.getByRole("button", { name: "Identify this crop" })).toBeVisible();
    },
  },
  {
    name: "identify, not a bird",
    path: "#/",
    ready: async (page) => {
      await page.locator('input[type="file"]').setInputFiles({ name: "noise.png", mimeType: "image/png", buffer: noisePng() });
      await expect(page.locator("article.card h2.species")).toHaveText("Not a bird I know", { timeout: 60_000 });
    },
  },
  {
    name: "notebook, empty",
    path: "#/notebook",
    ready: (page) => expect(page.getByText("Nothing here yet")).toBeVisible(),
  },
  {
    name: "notebook, with a Sighting",
    path: "#/notebook",
    setup: withSighting,
    ready: async (page) => {
      await expect(page.getByText("Two of them squabbling")).toBeVisible();
      await page.getByRole("button", { name: "Edit note" }).click();
      await expect(page.getByRole("textbox", { name: "Place" })).toBeFocused();
    },
  },
  {
    name: "species",
    path: "#/species",
    setup: withSighting,
    ready: (page) => expect(page.getByRole("link", { name: /Blue Jay/ })).toBeVisible(),
  },
  {
    name: "species page",
    path: "#/species/blue-jay",
    setup: withSighting,
    ready: async (page) => {
      await expect(page.locator(".plate img")).toBeVisible();
      await expect(page.getByText("Seen 2 times")).toBeVisible();
    },
  },
  {
    name: "about",
    path: "#/about",
    ready: async (page) => {
      await page.locator(".credits summary").click();
      await expect(page.locator(".credits li").first()).toBeVisible();
    },
  },
];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    // No animations, so colours are measured at rest rather than mid-fade.
    test.use({ colorScheme, reducedMotion: "reduce" });

    for (const { name, path, setup, ready } of PAGES) {
      test(`${name} has no serious or critical axe violations`, async ({ page }, info) => {
        await setup?.(page);
        await page.goto(path);
        await ready(page);
        // The page's faint dot grid is a background image, which makes axe give up on measuring
        // colour contrast ("needs review"). The dots are 1px, so measure against the plain paper.
        await page.addStyleTag({ content: "body { background-image: none !important; }" });
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        await info.attach("axe-results.json", {
          body: JSON.stringify({ violations: results.violations, incomplete: results.incomplete }, null, 2),
          contentType: "application/json",
        });
        const brief = (list: typeof results.violations) => list.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(1).join(" ")}`),
        }));
        const violations = brief(results.violations);
        const review = brief(results.incomplete);
        if (violations.length || review.length) {
          console.log(`[axe] ${colorScheme} / ${name}:`, JSON.stringify({ violations, review }, null, 2));
        }
        expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
      });
    }
  });
}

test("keyboard focus follows the page order and is always visible", async ({ page }) => {
  await page.goto("#/");
  await expect(page.locator(".examples img").first()).toBeVisible();
  const order: string[] = [];
  for (let i = 0; i < 13; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return {
        name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
        ring: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
      };
    });
    expect(focused.ring, `focus ring on "${focused.name}"`).toBe(true);
    order.push(focused.name);
  }
  expect(order).toEqual([
    "Field Guide", "Identify", "Notebook", "Species", "About", "Choose a photo",
    ...["Northern Cardinal", "Blue Jay", "Painted Bunting", "Belted Kingfisher", "American Goldfinch", "Pileated Woodpecker"]
      .map((s) => `Try the example photo: ${s}`),
    "source",
  ]);
});
