import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture parameter even without dependencies.
  baseURL: async ({}, use) => {
    const url = process.env.SITUATE_BROWSER_URL;
    if (!url)
      throw new Error("The browser test server did not provide its endpoint.");
    await use(url);
  },
});
