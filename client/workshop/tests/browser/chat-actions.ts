import type { Page } from "./test";

export async function chatAction(page: Page, action: string | RegExp) {
  await page.getByRole("button", { name: "Chat actions", exact: true }).click();
  await page
    .getByRole("menu", { name: "Chat actions", exact: true })
    .getByRole("menuitem", { name: action, exact: true })
    .click();
}

export function toggleChanges(page: Page) {
  return chatAction(page, /^(Show|Hide) changes$/);
}
