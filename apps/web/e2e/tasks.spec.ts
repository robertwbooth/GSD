import { expect, test } from "@playwright/test";
import { addTask, row, signIn, uid } from "./helpers";

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("nope");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password");
});

test("quick add parses date, priority, tags and shows in the right smart lists", async ({ page }) => {
  await signIn(page);
  const name = `Dentist ${uid()}`;
  await page.getByRole("link", { name: /Inbox/ }).click();
  await page.locator("#quick-add").fill(`${name} tomorrow 5pm !high #health`);
  await expect(page.locator(".chips")).toContainText("Tomorrow");
  await expect(page.locator(".chips")).toContainText("High");
  await page.locator("#quick-add").press("Enter");

  const r = row(page, name);
  await expect(r).toContainText("#health");
  await expect(r).toContainText("Tomorrow");
  await expect(r.getByRole("checkbox")).toHaveClass(/p5/);

  await page.getByRole("link", { name: /^Tomorrow/ }).click();
  await expect(row(page, name)).toBeVisible();
  await page.getByRole("link", { name: /^Today/ }).click();
  await expect(row(page, name)).toHaveCount(0);
  await page.getByRole("link", { name: /^health/ }).click();
  await expect(row(page, name)).toBeVisible();
});

test("adding in Today sets today's date", async ({ page }) => {
  await signIn(page);
  const name = `Water plants ${uid()}`;
  await page.getByRole("link", { name: /^Today/ }).click();
  await addTask(page, name);
  await expect(row(page, name)).toContainText("Today");
});

test("complete, undo, and find in Completed", async ({ page }) => {
  await signIn(page);
  const name = `Finish ${uid()}`;
  await page.getByRole("link", { name: /Inbox/ }).click();
  await addTask(page, name);
  await row(page, name).getByRole("checkbox").click();
  await expect(row(page, name)).toHaveCount(0);
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(row(page, name)).toBeVisible();

  await row(page, name).getByRole("checkbox").click();
  await page.getByRole("link", { name: /Completed/ }).click();
  await expect(row(page, name)).toBeVisible();
});

test("repeating task moves to its next date when completed", async ({ page }) => {
  await signIn(page);
  const name = `Stretch ${uid()}`;
  await page.getByRole("link", { name: /Inbox/ }).click();
  await addTask(page, `${name} every day`);
  await expect(row(page, name)).toContainText("Today");
  await row(page, name).getByRole("checkbox").click();
  await expect(row(page, name)).toContainText("Tomorrow");
  await page.getByRole("link", { name: /Completed/ }).click();
  await expect(row(page, name)).toBeVisible();
});

test("lists: create, add to, and move tasks between lists", async ({ page }) => {
  await signIn(page);
  const list = `Garden ${uid()}`;
  await page.getByRole("button", { name: "Add list" }).click();
  await page.getByLabel("New list name").fill(list);
  await page.getByLabel("New list name").press("Enter");
  await expect(page.getByRole("heading", { name: list })).toBeVisible();

  const name = `Plant bulbs ${uid()}`;
  await addTask(page, name);
  await expect(row(page, name)).toBeVisible();

  // Quick add into a list by name from elsewhere.
  const other = `Mulch ${uid()}`;
  await page.getByRole("link", { name: /Inbox/ }).click();
  await addTask(page, `${other} ~"${list}"`);
  await page.getByRole("link", { name: new RegExp(list) }).click();
  await expect(row(page, other)).toBeVisible();

  // Move with the detail pane.
  await row(page, name).click();
  await page.getByLabel("List", { exact: true }).selectOption({ label: "Inbox" });
  await page.getByRole("link", { name: /Inbox/ }).click();
  await expect(row(page, name)).toBeVisible();
});

test("detail pane edits title, tags, checklist and subtasks", async ({ page }) => {
  await signIn(page);
  const name = `Trip ${uid()}`;
  await page.getByRole("link", { name: /Inbox/ }).click();
  await addTask(page, name);
  await row(page, name).click();

  const detail = page.getByRole("complementary", { name: "Task details" });
  await detail.getByLabel("Title").fill(`${name} to Tofino`);
  await detail.getByLabel("Add tags").fill("travel");
  await detail.getByLabel("Add tags").press("Enter");
  await detail.getByLabel("Add checklist item").fill("Book ferry");
  await detail.getByLabel("Add checklist item").press("Enter");
  await detail.getByLabel("Add subtask").fill("Pack bags");
  await detail.getByLabel("Add subtask").press("Enter");
  await detail.getByLabel("Description").fill("Long weekend");
  await detail.getByLabel("Priority").selectOption({ label: "Medium priority" });
  await page.keyboard.press("Escape");

  const r = row(page, `${name} to Tofino`);
  await expect(r).toContainText("#travel");
  await expect(r).toContainText("0/1");
  await expect(r.getByRole("checkbox")).toHaveClass(/p3/);
  // Subtask is nested under its parent.
  await expect(row(page, "Pack bags").last()).toHaveCSS("padding-left", "36px");
});

test("delete goes to Trash and can be restored", async ({ page }) => {
  await signIn(page);
  const name = `Old idea ${uid()}`;
  await page.getByRole("link", { name: /Inbox/ }).click();
  await addTask(page, name);
  await row(page, name).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(row(page, name)).toHaveCount(0);
  await page.getByRole("link", { name: /Trash/ }).click();
  await row(page, name).getByRole("button", { name: "Restore" }).click();
  await page.getByRole("link", { name: /Inbox/ }).click();
  await expect(row(page, name)).toBeVisible();
});

test("search finds tasks", async ({ page }) => {
  await signIn(page);
  const name = `Zebra ${uid()}`;
  await page.getByRole("link", { name: /Inbox/ }).click();
  await addTask(page, name);
  await page.getByLabel("Search tasks").fill(name.split(" ")[1]!);
  await page.getByLabel("Search tasks").press("Enter");
  await expect(row(page, name)).toBeVisible();
});

test("board view: sections and drag between columns", async ({ page }) => {
  await signIn(page);
  const list = `Board ${uid()}`;
  await page.getByRole("button", { name: "Add list" }).click();
  await page.getByLabel("New list name").fill(list);
  await page.getByLabel("New list name").press("Enter");
  await page.getByRole("button", { name: "Board" }).click();

  page.once("dialog", (d) => d.accept("Doing"));
  await page.getByRole("button", { name: "+ Add section" }).click();
  const doing = page.getByTestId("board-column").filter({ hasText: "Doing" });
  await expect(doing).toBeVisible();

  const name = `Card ${uid()}`;
  const first = page.getByTestId("board-column").first();
  await first.getByLabel("Add task").fill(name);
  await first.getByLabel("Add task").press("Enter");
  await expect(first.getByText(name)).toBeVisible();

  await row(page, name).dragTo(doing);
  await expect(doing.getByText(name)).toBeVisible();
  await expect(first.getByText(name)).toHaveCount(0);
});

test("works offline and syncs between devices", async ({ browser }) => {
  const a = await browser.newContext({ timezoneId: "America/Vancouver" });
  const b = await browser.newContext({ timezoneId: "America/Vancouver" });
  const pa = await a.newPage();
  const pb = await b.newPage();
  await signIn(pa);
  await signIn(pb);
  const name = `Synced ${uid()}`;

  await a.setOffline(true);
  await pa.getByRole("link", { name: /Inbox/ }).click();
  await addTask(pa, name);
  await pa.reload();
  await expect(row(pa, name)).toBeVisible(); // kept on device
  await a.setOffline(false);
  await pa.getByRole("button", { name: /Sync|Synced|Waiting|Can't reach|Offline/ }).first().click();
  await expect(pa.getByRole("button", { name: "Synced" })).toBeVisible();

  await pb.getByRole("link", { name: /Inbox/ }).click();
  await pb.getByRole("button", { name: /Synced|Waiting/ }).click();
  await expect(row(pb, name)).toBeVisible();
  await a.close();
  await b.close();
});
