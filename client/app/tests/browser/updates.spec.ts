import { expect, test, type Page } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import type { UpdateSnapshot } from "../../src/updates/runtime";

test.use({ localizationMode: "real" });
async function change(page: Page, value: Partial<UpdateSnapshot>) {
  await page.evaluate(
    (value) => Reflect.get(window, "__updatesTest").change(value),
    value,
  );
}
async function calls(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      (
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: Record<string, unknown>;
        }[]
      ).filter((call) => call.command === command),
    command,
  );
}
async function openUpdates(page: Page) {
  await page
    .getByRole("button", { name: "Update available", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Updates", exact: true }),
  ).toBeVisible();
}

test(
  "ready indication opens settings without shifting work and postpones running actions",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await workspaceFixture(page, shellState, {
      updates: {
        supported: true,
        phase: "ready",
        artifactId: "artifact-b",
        availableVersion: "1.1.0",
        runningActions: true,
      },
    });
    await page.goto("/");
    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await composer.fill("Keep this draft");
    const before = await composer.boundingBox();
    const notice = page.getByRole("button", {
      name: "Update available",
      exact: true,
    });
    await notice.focus();
    await notice.press("ArrowRight");
    await expect(notice).toBeFocused();
    await expect(notice).toHaveCSS("outline-style", "solid");
    await expect(page.locator(".notice-label")).toHaveCSS("opacity", "1");
    expect(await composer.boundingBox()).toEqual(before);
    await visual.capture("updates.notice.focused");
    await notice.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Ready when you are" }),
    ).toBeVisible();
    await expect(page.locator(".update-category-badge")).toHaveAccessibleName(
      "Update available",
    );
    await visual.capture("updates.settings.ready");
    const install = page.getByRole("button", {
      name: "Install and restart",
      exact: true,
    });
    await install.click();
    const dialog = page.getByRole("dialog", {
      name: "Restart to update Situate?",
    });
    await expect(dialog).toContainText("another message");
    await expect(dialog.getByRole("button", { name: "Not now" })).toBeFocused();
    await visual.capture("updates.restart.running");
    await dialog.press("Escape");
    await expect(install).toBeFocused();
    expect(await calls(page, "updates_install")).toHaveLength(0);
    await install.click();
    await dialog
      .getByRole("button", { name: "Stop actions and restart" })
      .click();
    expect((await calls(page, "updates_install"))[0].args).toEqual({
      artifactId: "artifact-b",
      abortRunning: true,
    });
  },
);

test(
  "failed window preparation offers a separately confirmed forced update",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await workspaceFixture(page, shellState, {
      updates: {
        supported: true,
        phase: "install-failed",
        artifactId: "artifact-b",
        availableVersion: "1.1.0",
        error: "native.updates.preparationFailed",
      },
    });
    await page.goto("/");
    await openUpdates(page);
    await expect(page.getByRole("alert")).toContainText("An open window");
    await expect(
      page.getByRole("button", { name: "Force update…", exact: true }),
    ).toBeVisible();
    await visual.capture("updates.settings.preparation-failed");
    await page
      .getByRole("button", { name: "Force update…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Force update and restart?",
      exact: true,
    });
    await expect(dialog).toContainText(
      "Unsaved changes in any window may be lost",
    );
    await expect(
      dialog.getByRole("button", { name: "Not now", exact: true }),
    ).toBeFocused();
    expect(await calls(page, "updates_install")).toHaveLength(0);
    await visual.capture("updates.restart.forced");
    await dialog.getByRole("button", { name: "Not now", exact: true }).click();
    expect(await calls(page, "updates_install")).toHaveLength(0);
    await page
      .getByRole("button", { name: "Try installation again", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Restart to update Situate?", exact: true })
      .getByRole("button", { name: "Force update…", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Not now", exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole("button", { name: "Force update and restart", exact: true })
      .click();
    expect((await calls(page, "updates_install"))[0].args).toEqual({
      artifactId: "artifact-b",
      abortRunning: true,
      force: true,
    });
  },
);

test(
  "native phases, manual errors and retries remain inline while download outlives settings",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await workspaceFixture(page, shellState, {
      updates: {
        supported: true,
        phase: "ready",
        artifactId: "artifact-b",
        availableVersion: "1.1.0",
      },
      updateCheckError: "native.updates.checkFailed",
    });
    await page.goto("/");
    await openUpdates(page);
    await change(page, { phase: "current", availableVersion: null });
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Check your connection",
    );
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await visual.capture("updates.settings.check-failed");
    await change(page, { phase: "checking" });
    await expect(
      page.getByRole("heading", { name: "Checking for updates…" }),
    ).toBeVisible();
    await change(page, {
      phase: "downloading",
      artifactId: "artifact-b",
      availableVersion: "1.1.0",
      downloadedBytes: 32_000_000,
      totalBytes: null,
    });
    await expect(page.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    await expect(page.locator(".progress-meta")).toHaveText(
      "32.0 MB downloaded",
    );
    await visual.capture("updates.settings.download-unknown");
    await change(page, { totalBytes: 128_000_000 });
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    await visual.capture("updates.settings.download");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.locator(".settings-view")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__updatesTest").listenerCount(),
      ),
    ).toBe(1);
    await change(page, { phase: "ready", downloadedBytes: 128_000_000 });
    await openUpdates(page);
    await expect(
      page.getByRole("heading", { name: "Ready when you are" }),
    ).toBeVisible();
    await change(page, {
      phase: "download-failed",
      error: "native.updates.downloadFailed",
    });
    await page.getByRole("button", { name: "Retry download" }).click();
    expect(await calls(page, "updates_check")).toHaveLength(2);
    await change(page, { phase: "preparing", error: null });
    await expect(
      page.getByRole("heading", { name: "Preparing update…" }),
    ).toBeVisible();
    await change(page, { phase: "installing" });
    await expect(
      page.getByRole("heading", { name: "Installing update…" }),
    ).toBeVisible();
    await change(page, {
      phase: "install-failed",
      error: "native.updates.installFailed",
    });
    await expect(
      page.getByRole("button", { name: "Try installation again" }),
    ).toBeVisible();
    await change(page, {
      phase: "recovery-required",
      error: "native.updates.recoveryRequired",
    });
    await expect(
      page.getByText("Do not delete or reset your workspaces.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.locator(".status-actions button")).toHaveCount(0);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(await calls(page, "updates_install")).toHaveLength(0);
    await visual.capture("updates.settings.recovery");
  },
);

test(
  "narrow ready indication stays bottom-right clear of a centered composer and respects reduced motion",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await workspaceFixture(page, shellState, {
      updates: {
        supported: true,
        phase: "ready",
        artifactId: "artifact-b",
        availableVersion: "1.1.0",
      },
    });
    await page.goto("/");
    const composer = page.locator(".chat-composer");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("A draft\nwith several\nlines\nto keep");
    const notice = page.getByRole("button", {
      name: "Update available",
      exact: true,
    });
    await expect
      .poll(async () => {
        const mark = await notice.boundingBox();
        const input = await composer.boundingBox();
        return (
          !!mark &&
          !!input &&
          (mark.y + mark.height <= input.y || mark.y >= input.y + input.height)
        );
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const bounds = (await notice.boundingBox())!;
        return 760 - bounds.y - bounds.height;
      })
      .toBe(16);
    const bounds = (await notice.boundingBox())!;
    expect(390 - bounds.x - bounds.width).toBe(16);
    await notice.focus();
    await expect(page.locator(".notice-label")).toHaveCSS(
      "transition-duration",
      "0s",
    );
    await visual.capture("updates.notice.narrow");
    await notice.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Ready when you are" }),
    ).toBeVisible();
    await visual.capture("updates.settings.narrow");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  },
);

test("narrow ready indication clears a bottom-anchored composer as its draft grows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await workspaceFixture(page, shellState, {
    updates: {
      supported: true,
      phase: "ready",
      artifactId: "artifact-b",
      availableVersion: "1.1.0",
    },
    aiConnection: { provider: "custom", endpoint: "http://localhost:8888/v1" },
    aiModel: "test-model",
    aiHoldResponse: true,
  });
  await page.goto("/");
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("A topic to discuss");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toBeVisible();
  const notice = page.getByRole("button", {
    name: "Update available",
    exact: true,
  });
  const composer = page.locator(".chat-composer");
  for (const text of [
    "Next question",
    "Next question\nwith several\nmore lines\nto keep",
  ]) {
    await draft.fill(text);
    await expect
      .poll(async () => {
        const mark = await notice.boundingBox();
        const input = await composer.boundingBox();
        return (
          !!mark &&
          !!input &&
          input.y + input.height > 700 &&
          mark.y + mark.height <= input.y
        );
      })
      .toBe(true);
  }
  await notice.focus();
  await expect(page.locator(".notice-label")).toHaveCSS("opacity", "1");
  const label = (await page.locator(".notice-label").boundingBox())!;
  expect(label.y + label.height).toBeLessThanOrEqual(
    (await composer.boundingBox())!.y,
  );
});

test("inspecting and postponing an update leaves active dictation running", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    dictationModel: "ready",
    updates: {
      supported: true,
      phase: "ready",
      artifactId: "artifact-b",
      availableVersion: "1.1.0",
      runningActions: true,
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Dictate text", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording and transcribe" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Update available", exact: true })
    .click();
  const area = page.getByRole("dialog", { name: "Updates", exact: true });
  await area
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Restart to update Situate?" })
    .getByRole("button", { name: "Not now" })
    .click();
  await area.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording and transcribe" }),
  ).toBeVisible();
  expect(await calls(page, "dictation_control")).toHaveLength(0);
  expect(await calls(page, "updates_install")).toHaveLength(0);
});

test("updates remain accessible without an open workspace and idle restart needs confirmation", async ({
  page,
}) => {
  await workspaceFixture(
    page,
    { ...shellState, current: null, open: [] },
    {
      updates: {
        supported: true,
        phase: "ready",
        artifactId: "artifact-b",
        availableVersion: "1.1.0",
      },
    },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Update available", exact: true })
    .click();
  const area = page.getByRole("dialog", { name: "Updates", exact: true });
  await expect(
    area.getByRole("heading", { name: "Ready when you are" }),
  ).toBeVisible();
  expect(await calls(page, "updates_install")).toHaveLength(0);
  await area
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Restart to update Situate?",
  });
  await expect(
    confirmation.getByRole("button", { name: "Not now" }),
  ).toBeFocused();
  await confirmation
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  expect((await calls(page, "updates_install"))[0].args).toEqual({
    artifactId: "artifact-b",
    abortRunning: false,
  });
});

for (const version of ["1.2.0", "1.1.0"]) {
  test(`background replacement at version ${version} requires a new restart confirmation`, async ({
    page,
  }) => {
    await workspaceFixture(page, shellState, {
      updates: {
        supported: true,
        phase: "ready",
        availableVersion: "1.1.0",
        artifactId: "artifact-b",
        runningActions: true,
      },
    });
    await page.goto("/");
    await openUpdates(page);
    const install = page
      .locator(".status-actions")
      .getByRole("button", { name: "Install and restart", exact: true });
    await install.click();
    const dialog = page.getByRole("dialog", {
      name: "Restart to update Situate?",
    });
    await expect(dialog).toBeVisible();
    await change(page, { availableVersion: version, artifactId: "artifact-c" });
    await expect(dialog).not.toBeVisible();
    expect(await calls(page, "updates_install")).toHaveLength(0);
    await install.click();
    await dialog
      .getByRole("button", { name: "Stop actions and restart" })
      .click();
    expect((await calls(page, "updates_install"))[0].args).toEqual({
      artifactId: "artifact-c",
      abortRunning: true,
    });
  });
}

test("externally managed installations omit settings and never issue manual updater commands", async ({
  page,
}) => {
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await page.locator(".settings-action").click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Updates", exact: false }),
  ).toHaveCount(0);
  await expect(page.locator(".update-notice")).toHaveCount(0);
  expect(await calls(page, "updates_check")).toHaveLength(0);
  expect(await calls(page, "updates_install")).toHaveLength(0);
});
