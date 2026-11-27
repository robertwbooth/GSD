import { expect, test } from "@playwright/test";
import { addTask, row, signIn, uid } from "./helpers";

test("archive a list and browse repeating-task history", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Lists" });
  const list = `Plan ${uid()}`;
  await page.getByRole("button", { name: "Add list" }).click();
  await page.getByLabel("New list name").fill(list);
  await page.getByLabel("New list name").press("Enter");
  const habit = `Journal ${uid()}`;
  const once = `Book flights ${uid()}`;
  await addTask(page, `${habit} every day`);
  await addTask(page, `${once} today`);
  await row(page, habit).getByRole("checkbox").click();
  await expect(row(page, habit)).toContainText("Tomorrow");
  await row(page, once).getByRole("checkbox").click();

  // Completed can show only repeating tasks' completions.
  await nav.getByRole("link", { name: /Completed/ }).click();
  await expect(row(page, habit)).toBeVisible();
  await expect(row(page, once)).toBeVisible();
  await page.getByRole("button", { name: "Repeating tasks" }).click();
  await expect(row(page, habit)).toBeVisible();
  await expect(row(page, once)).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();

  // Archiving moves the list away and keeps its tasks out of Next 7 Days.
  await nav.getByRole("link", { name: list }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive list" }).click();
  await expect(nav.getByRole("link", { name: list })).toHaveCount(0);
  await nav.getByRole("link", { name: /Next 7 Days/ }).click();
  await expect(row(page, habit)).toHaveCount(0);
  await nav.getByRole("button", { name: /Archived lists/ }).click();
  await nav.getByRole("link", { name: list }).click();
  await expect(page.getByRole("status").filter({ hasText: "archived" })).toBeVisible();
  await page.getByRole("button", { name: "Unarchive" }).click();
  await nav.getByRole("link", { name: /Next 7 Days/ }).click();
  await expect(row(page, habit)).toBeVisible();
});
