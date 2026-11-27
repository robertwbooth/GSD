import { expect, test } from "@playwright/test";
import { addTask, row, signIn, uid } from "./helpers";

test("right-click a task to change its date, priority and list", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Lists" });
  const list = `Errands ${uid()}`;
  await page.getByRole("button", { name: "Add list" }).click();
  await page.getByLabel("New list name").fill(list);
  await page.getByLabel("New list name").press("Enter");
  await nav.getByRole("link", { name: /Inbox/ }).click();
  const name = `Buy stamps ${uid()}`;
  await addTask(page, name);

  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Tomorrow" }).click();
  await expect(row(page, name)).toContainText("Tomorrow");

  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Priority" }).hover();
  await page.getByRole("menuitemcheckbox", { name: "High" }).click();
  await expect(row(page, name).getByRole("checkbox")).toHaveClass(/p5/);

  // Undo puts the old priority back.
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(row(page, name).getByRole("checkbox")).toHaveClass(/p0/);

  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(row(page, name)).toHaveCount(2);

  await row(page, name).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to" }).click();
  await page.getByRole("menuitemcheckbox", { name: list }).click();
  await expect(row(page, name)).toHaveCount(1);
  await nav.getByRole("link", { name: list }).click();
  await expect(row(page, name)).toHaveCount(1);

  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(row(page, name)).toHaveCount(0);
});

test("right-click a note page to rename or add a page inside", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /^Notes/ }).click();
  await page.getByRole("button", { name: "New page" }).click();
  const title = `Trip ${uid()}`;
  await page.getByLabel("Page title").fill(title);
  await page.getByLabel("Page title").blur();
  const tree = page.locator(".notes-tree");
  await expect(tree.getByTestId("page-row").filter({ hasText: title })).toBeVisible();

  page.once("dialog", (d) => d.accept(`${title} plan`));
  await tree.getByTestId("page-row").filter({ hasText: title }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(tree.getByTestId("page-row").filter({ hasText: `${title} plan` })).toBeVisible();
  await expect(page.getByLabel("Page title")).toHaveValue(`${title} plan`);

  await tree.getByTestId("page-row").filter({ hasText: `${title} plan` }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add page inside" }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(`${title} plan`);
});
