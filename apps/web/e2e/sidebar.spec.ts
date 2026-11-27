import { expect, test } from "@playwright/test";
import { addTask, row, signIn, uid } from "./helpers";

test("hide and show lists and tags from the sidebar", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Lists" });
  const list = `Someday ${uid()}`;
  const tag = `later${uid()}`;
  await page.getByRole("button", { name: "Add list" }).click();
  await page.getByLabel("New list name").fill(list);
  await page.getByLabel("New list name").press("Enter");
  const task = `Paint shed ${uid()}`;
  await addTask(page, `${task} today #${tag}`);

  // Hiding a list moves it to "Hidden lists" and keeps its tasks out of Today.
  await nav.getByRole("link", { name: list }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide list" }).click();
  await expect(nav.getByRole("link", { name: list })).toHaveCount(0);
  await nav.getByRole("link", { name: /^Today/ }).click();
  await expect(row(page, task)).toHaveCount(0);
  await nav.getByRole("button", { name: /Hidden lists/ }).click();
  await nav.getByRole("link", { name: list }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show list" }).click();
  await expect(row(page, task)).toBeVisible();

  // Tags hide into their own group, and the choice survives a reload.
  await nav.getByRole("link", { name: tag }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide tag" }).click();
  await expect(nav.getByRole("link", { name: tag })).toHaveCount(0);
  await page.reload();
  await expect(nav.getByRole("button", { name: /Hidden tags/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: tag })).toHaveCount(0);

  // Section headings collapse.
  await nav.getByRole("button", { name: "Lists", exact: true }).click();
  await expect(nav.getByRole("link", { name: list })).toHaveCount(0);
  await nav.getByRole("button", { name: "Lists", exact: true }).click();
  await expect(nav.getByRole("link", { name: list })).toBeVisible();

  // Escape closes a menu without doing anything.
  await nav.getByRole("link", { name: list }).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
