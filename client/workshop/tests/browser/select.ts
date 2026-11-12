import { expect, type Locator } from "@playwright/test";

export async function chooseSelect(control: Locator, value: string) {
  await control.click();
  const popup = control.page().locator(".situate-select-popup");
  await expect(popup).toBeVisible();
  await popup
    .locator(`[role="option"][data-option-value=${JSON.stringify(value)}]`)
    .click();
  await expect(popup).toHaveCount(0);
}

export const selectOption = chooseSelect;

export async function selectOptions(control: Locator) {
  await control.click();
  const popup = control.page().locator(".situate-select-popup");
  await expect(popup).toBeVisible();
  const options = await popup.getByRole("option").evaluateAll((items) =>
    items.map((item) => ({
      value: item.getAttribute("data-option-value")!,
      label: item.querySelector("span")!.textContent!.trim(),
    })),
  );
  await popup.getByRole("listbox").press("Escape");
  await expect(popup).toHaveCount(0);
  return options;
}
