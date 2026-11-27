import { expect, noisePng, test } from "./fixtures";

const verdict = (page: import("@playwright/test").Page) => page.locator("article.card h2.species");

test("identifies two example photos, adds one to the notebook, and visits every page", async ({ page }) => {
  await page.goto("#/");
  await expect(page.getByRole("heading", { level: 1, name: "What bird is that?" })).toBeVisible();
  const nav = page.getByRole("navigation");

  for (const species of ["Northern Cardinal", "Blue Jay"]) {
    await page.getByRole("button", { name: `Try the example photo: ${species}` }).click();
    await expect(verdict(page)).toHaveText(species, { timeout: 60_000 });
    // The Verdict is announced to screen readers.
    await expect(page.getByRole("status").filter({ hasText: `Identified as ${species}` })).toBeAttached();
  }

  await page.getByRole("button", { name: "+ Add to my notebook" }).click();
  await expect(page.getByText("✓ In your notebook")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Notebook/ })).toContainText("1");

  await nav.getByRole("link", { name: /Notebook/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My field notebook" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Blue Jay" })).toBeVisible();

  await nav.getByRole("link", { name: "Species" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The 200 species" })).toBeVisible();
  await page.getByRole("link", { name: /Blue Jay/ }).click();
  await expect(page).toHaveURL(/#\/species\/blue-jay$/);
  await expect(page.getByRole("heading", { level: 1, name: "Blue Jay" })).toBeVisible();
  await expect(page.getByText("Seen once")).toBeVisible();
  await expect(page.locator(".plate img")).toHaveJSProperty("complete", true);

  await nav.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How it works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How good is it?" })).toBeVisible();

  await nav.getByRole("link", { name: "Identify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What bird is that?" })).toBeVisible();
});

test("says a noise image is not a bird it knows", async ({ page }) => {
  await page.goto("#/");
  await page.locator('input[type="file"]').setInputFiles({ name: "noise.png", mimeType: "image/png", buffer: noisePng() });
  await expect(verdict(page)).toHaveText("Not a bird I know", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "+ Add to my notebook" })).toHaveCount(0);
});
