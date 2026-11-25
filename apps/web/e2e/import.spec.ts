import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { row, signIn } from "./helpers";

const sample = fileURLToPath(new URL("./ticktick-sample.csv", import.meta.url));

test("imports a TickTick backup with folders, lists, subtasks and board columns", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Import/ }).click();
  await page.getByLabel("Choose backup file").setInputFiles(sample);
  await expect(page.getByText("Ready to import")).toBeVisible();
  await expect(page.getByText(/1 notes will import with Notes/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Added 6 tasks");

  // Folder groups its lists in the sidebar.
  const nav = page.getByRole("navigation", { name: "Lists" });
  await expect(nav.getByRole("button", { name: "💚Personal" })).toBeVisible();
  await nav.getByRole("link", { name: /^Cycling/ }).click();
  await expect(row(page, "Service bike")).toContainText("1/2");
  await expect(row(page, "Weekly ride")).toBeVisible();

  // Board list with its column.
  await nav.getByRole("link", { name: /Projects/ }).click();
  await expect(page.getByTestId("board-column").filter({ hasText: "Admin" })).toBeVisible();

  // Completed subtask shows in Completed; Inbox task in Inbox.
  await nav.getByRole("link", { name: /Completed/ }).click();
  await expect(row(page, "Order parts")).toBeVisible();
  await nav.getByRole("link", { name: /Inbox/ }).click();
  await expect(row(page, "Buy milk")).toBeVisible();

  // Importing again adds nothing.
  await nav.getByRole("link", { name: /Import/ }).click();
  await page.getByLabel("Choose backup file").setInputFiles(sample);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Added 0 tasks");
});

test("rejects files that aren't TickTick backups", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Import/ }).click();
  await page.getByLabel("Choose backup file").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") });
  await expect(page.getByRole("alert")).toContainText("doesn't look like a TickTick backup");
});
