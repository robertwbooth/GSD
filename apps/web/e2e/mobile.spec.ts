import { expect, test } from "@playwright/test";
import { addTask, row, uid } from "./helpers";

test("phone layout: drawer navigation and full-screen details", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: /Inbox/ }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

  const name = `Phone ${uid()}`;
  await addTask(page, name);
  await row(page, name).click();
  await expect(page.getByRole("complementary", { name: "Task details" })).toBeVisible();
  await expect(page.locator("#quick-add")).toBeHidden();
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(row(page, name)).toBeVisible();

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
