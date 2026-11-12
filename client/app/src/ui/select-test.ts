import { DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

export async function chooseSelect(
  wrapper: VueWrapper,
  selector: string,
  value: string,
) {
  await wrapper.get(selector).trigger("click");
  await nextTick();
  const option = document.querySelector<HTMLElement>(
    `.situate-select-popup [role="option"][data-option-value=${JSON.stringify(value)}]`,
  );
  if (!option) throw new Error(`Select option not found: ${value}`);
  await new DOMWrapper(option).trigger("click");
}
