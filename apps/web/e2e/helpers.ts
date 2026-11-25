import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Lists" })).toBeVisible();
}

export async function addTask(page: Page, text: string) {
  const input = page.locator("#quick-add");
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

export const row = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title });

export function uid() {
  return Math.random().toString(36).slice(2, 7);
}
