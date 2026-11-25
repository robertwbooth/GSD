import { expect, test } from "@playwright/test";
import { signIn, uid } from "./helpers";

test("create, edit, nest and sync note pages", async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: "America/Vancouver" });
  const page = await ctx.newPage();
  await signIn(page);
  await page.getByRole("link", { name: /^Notes/ }).click();
  await page.getByRole("button", { name: "New page" }).click();

  const title = `Ideas ${uid()}`;
  await page.getByLabel("Page title").fill(title);
  const body = page.locator(".note-body .ProseMirror");
  await body.click();
  await page.keyboard.type("# Big heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[ ] first thing");
  await expect(body.locator("h1")).toHaveText("Big heading");
  await expect(body.locator('ul[data-type="taskList"]')).toContainText("first thing");

  // Sub-page from the toolbar links back to its parent.
  await page.getByRole("button", { name: "Sub-page" }).click();
  // Wait for the new page to open before typing its title.
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(title);
  await expect(page.getByLabel("Page title")).toHaveValue("");
  await page.getByLabel("Page title").fill("Child page");
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: title }).click();
  await expect(page.getByLabel("Page title")).toHaveValue(title);
  await page.locator(".note-title").blur();

  // Persisted locally and synced to another device.
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as { gsdFlush: () => Promise<void> }).gsdFlush());
  await page.getByRole("button", { name: /Synced|Waiting|Syncing/ }).first().click();
  await expect(page.getByRole("button", { name: "Synced" })).toBeVisible();

  const other = await browser.newContext({ timezoneId: "America/Vancouver" });
  const p2 = await other.newPage();
  await signIn(p2);
  await p2.getByRole("link", { name: /^Notes/ }).click();
  await p2.getByTestId("page-row").filter({ hasText: title }).click();
  await expect(p2.locator(".note-body h1")).toHaveText("Big heading");
  await p2.getByTestId("page-row").filter({ hasText: title }).getByRole("button", { name: "Expand" }).click();
  await expect(p2.getByTestId("page-row").filter({ hasText: "Child page" })).toBeVisible();

  // Search finds pages by their text.
  await p2.getByLabel("Search notes").fill("first thing");
  await expect(p2.getByTestId("page-row").filter({ hasText: title })).toBeVisible();
  await ctx.close();
  await other.close();
});
