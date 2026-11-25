import { expect, test } from "@playwright/test";
import { signIn, uid } from "./helpers";

test("feedback from the shortcut and the feedback page", async ({ page }) => {
  await signIn(page);
  const text = `Please add dark mode toggle ${uid()}`;
  await page.locator("body").press("f");
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByRole("radio", { name: "New idea" }).click();
  await dialog.getByRole("textbox", { name: "Feedback" }).fill(text);
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("status")).toContainText("Feedback saved");

  await page.getByRole("link", { name: /Feedback/ }).click();
  await expect(page.getByText(text)).toBeVisible();
  await expect(page.getByText(/GitHub isn't connected/)).toBeVisible();
});
