import { selectOption } from "./select";
import { expect, type Page } from "./test";
import { isScenario } from "../../src/workshop/simulation";
import { scenarioForState } from "../../src/workshop/scenario-catalog";

export async function selectScenario(page: Page, id: string) {
  if (!isScenario(id)) throw new Error(`Unknown scenario state: ${id}`);
  const scenario = scenarioForState(id);
  const list = page.getByRole("combobox", { name: "Scenario", exact: true });
  const sameScenario = (await list.getAttribute("data-value")) === scenario.id;
  if (!sameScenario) await selectOption(list, scenario.id);
  if (scenario.states.length > 1) {
    const states = page.getByLabel("Starting state", { exact: true });
    if ((await states.getAttribute("data-value")) !== id)
      await selectOption(states, id);
    else if (sameScenario)
      await page
        .getByRole("button", { name: "Reset scenario", exact: true })
        .click();
  } else if (sameScenario)
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
  await expect(page).toHaveURL(new RegExp(`[?&]scenario=${id}(?:&|$)`));
}
