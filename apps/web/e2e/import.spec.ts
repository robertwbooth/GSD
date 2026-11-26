import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { row, signIn } from "./helpers";

const sample = fileURLToPath(new URL("./ticktick-sample.csv", import.meta.url));

test("imports a TickTick backup with folders, lists, subtasks and board columns", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Import/ }).click();
  await page.getByLabel("Choose backup file").setInputFiles(sample);
  await expect(page.getByText("Ready to import")).toBeVisible();
  await expect(page.getByText(/1 notes, which go into Notes/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Added 6 tasks");
  await expect(page.getByRole("status")).toContainText("Added 3 pages to Notes");

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
  await expect(page.getByRole("status")).toContainText("Nothing new to add");
});

test("rejects files that aren't TickTick backups", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Import/ }).click();
  await page.getByLabel("Choose backup file").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") });
  await expect(page.getByRole("alert")).toContainText("doesn't look like a TickTick backup");
});

test("imports a Notion export into Notes", async ({ page }) => {
  const { zipSync, strToU8 } = await import("fflate");
  const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);
  const zip = zipSync({
    [`Export-1/Trip ${A}.md`]: strToU8(`# 🧳Trip\n\nSee [Day one](Trip/Day%20one%20${B}.md).`),
    [`Export-1/Trip/Day one ${B}.md`]: strToU8(`# Day one\n\n- [ ] Book ferry`),
    [`Export-1/Gear ${C}.md`]: strToU8(`# Gear\n\n[Gear](Gear%20${C}_all.csv)`),
    [`Export-1/Gear ${C}_all.csv`]: strToU8(`Item,Packed\nTent,Yes\n`),
  });
  await signIn(page);
  await page.getByRole("link", { name: /Import/ }).click();
  await page.getByLabel("Choose backup file").setInputFiles({ name: "notion.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByText("3 Notion pages")).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Added 3 pages to Notes");
  await page.getByRole("link", { name: "Open Notes" }).click();

  await page.getByTestId("page-row").filter({ hasText: "Trip" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Trip");
  await page.locator(".note-body").getByRole("link", { name: "Day one" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Day one");
  await expect(page.locator(".note-body")).toContainText("Book ferry");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Trip");

  await page.getByTestId("page-row").filter({ hasText: "Gear" }).click();
  await expect(page.locator(".note-body table")).toContainText("Tent");
});
