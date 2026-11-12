import { expect, type Locator } from "@playwright/test";

export async function chooseSelect(
  control: Locator,
  choice: string | { label: string },
): Promise<void> {
  await control.click();
  const popup = control
    .page()
    .getByRole("dialog")
    .filter({ has: control.page().getByRole("listbox") });
  await expect(popup).toBeVisible();
  const option =
    typeof choice === "string"
      ? popup.locator(
          `[role="option"][data-option-value=${JSON.stringify(choice)}]`,
        )
      : popup.getByRole("option", { name: choice.label, exact: true });
  await option.click();
  await expect(popup).toHaveCount(0);
}
