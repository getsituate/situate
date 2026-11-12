import { test, expect, type Page } from "./test";
import { callbackPage, callbackText } from "./auth-callback-fixture.mjs";

test.use({ localizationMode: "real" });
type CallbackWindow = Window & { __callbackViolations?: string[] };

async function openCallback(
  page: Page,
  baseURL: string,
  language: "en" | "de",
  accepted = true,
) {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as CallbackWindow).__callbackViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as CallbackWindow).__callbackViolations!.push(
        event.violatedDirective,
      );
    });
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === baseURL &&
      url.pathname === "/auth/callback" &&
      route.request().isNavigationRequest()
    )
      return route.fulfill(callbackPage({ language, accepted }));
    unexpected.push(url.origin + url.pathname);
    return route.abort("blockedbyclient");
  });
  await page.goto(
    `${baseURL}/auth/callback?code=synthetic-browser-code&state=synthetic-browser-state`,
  );
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await expect(page.locator("body")).toHaveAttribute(
    "data-status",
    accepted ? "received" : "rejected",
  );
  const check = async () => {
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as CallbackWindow).__callbackViolations ?? [],
      ),
    ).toEqual([]);
    expect(await page.content()).not.toContain("synthetic-browser-code");
    expect(await page.content()).not.toContain("synthetic-browser-state");
  };
  return { check };
}

async function installFrameInspector(page: Page) {
  await page.addInitScript(() => {
    let id = 0;
    const frames = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      frames.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
    Reflect.set(window, "__callbackFrame", (time: number) => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(time);
      }
    });
  });
}

for (const callbackLocale of ["en-US", "de-DE"]) {
  test.describe(callbackLocale, () => {
    test.use({ locale: callbackLocale });
    test("confirmed connection and recovery @visual-desktop @visual-mobile", async ({
      page,
      baseURL,
      locale,
      visual,
    }) => {
      const language = locale?.startsWith("de") ? "de" : "en";
      await installFrameInspector(page);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const accepted = await openCallback(page, baseURL!, language);
      await expect(
        page.getByRole("heading", {
          name: callbackText(language, "accepted.title"),
        }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(page.locator(".callback-footer")).toBeHidden();
      await expect(page.locator(".callback-surface")).toHaveAttribute(
        "data-animation",
        "playing",
      );
      await page.evaluate(() => Reflect.get(window, "__callbackFrame")(0));
      await page.evaluate(() => Reflect.get(window, "__callbackFrame")(1500));
      await expect(page.locator(".callback-surface")).toHaveAttribute(
        "data-animation-time",
        "1500",
      );
      await expect(page.locator(".celebration-piece").first()).toBeVisible();
      await visual.capture("auth-callback.celebrating");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".callback-surface")).toHaveAttribute(
        "data-animation",
        "settled",
      );
      await expect(page.locator(".celebration-piece")).toHaveCount(0);
      await visual.capture("auth-callback.received");
      const help = page.locator("summary");
      await help.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText(callbackText(language, "accepted.helpBody")),
      ).toBeVisible();
      await expect(help).toBeFocused();
      await visual.capture("auth-callback.received-help");
      await accepted.check();

      const rejected = await openCallback(page, baseURL!, language, false);
      await expect(
        page.getByRole("heading", {
          name: callbackText(language, "rejected.title"),
        }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveText(
        callbackText(language, "rejected.status"),
      );
      await expect(page.locator(".callback-handoff")).toBeHidden();
      await expect(page.locator(".celebration-piece")).toHaveCount(0);
      await visual.capture("auth-callback.rejected");
      await page.locator("summary").click();
      await expect(
        page.getByText(callbackText(language, "helpBody")),
      ).toBeVisible();
      await visual.capture("auth-callback.rejected-help");
      await rejected.check();
    });
  });
}

test("German native copy and return help remain readable in constrained viewports", async ({
  page,
  baseURL,
  browserName,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const evidence = await openCallback(page, baseURL!, "de");
  await expect(
    page.getByText(callbackText("de", "accepted.body")),
  ).toBeVisible();
  await page.locator("summary").click();
  await expect(
    page.getByText(callbackText("de", "accepted.helpBody")),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [768, 640],
    [390, 844],
    [320, 568],
    [320, 350],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.locator("summary").scrollIntoViewIfNeeded();
    await expect(page.locator("summary")).toBeInViewport();
    expect(
      (await page.locator("summary").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    expect(
      await page
        .locator(".auth-callback")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.locator(".auth-callback").evaluate((element) => {
      element.scrollTop = 0;
    });
    // WebKit's screenshot preparation injects a stylesheet blocked by the page's CSP.
    if (browserName === "chromium")
      await page.screenshot({
        path: info.outputPath(`callback-de-${width}x${height}.png`),
      });
  }
  await evidence.check();
});

test("one finite viewport-wide celebration settles without navigation", async ({
  page,
  baseURL,
  browserName,
}, info) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const evidence = await openCallback(page, baseURL!, "en");
  const surface = page.locator(".callback-surface");
  await expect(surface).toHaveAttribute("data-animation", "playing");
  await expect(page.locator(".celebration-piece").first()).toBeVisible();
  if (browserName === "chromium")
    await page.screenshot({
      path: info.outputPath("callback-celebration.png"),
    });
  await expect(surface).toHaveAttribute("data-animation", "settled", {
    timeout: 8000,
  });
  await expect(surface).toHaveAttribute("data-animation-time", "4400");
  await expect(page.locator(".celebration-piece")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByText(callbackText("en", "accepted.body")),
  ).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page).toHaveURL(
    /\/auth\/callback\?code=synthetic-browser-code&state=synthetic-browser-state$/,
  );
  await evidence.check();
});

test("live reduced motion removes the confetti and resizing does not replay it", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const evidence = await openCallback(page, baseURL!, "en");
  await expect(page.locator(".celebration-piece").first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".callback-surface")).toHaveAttribute(
    "data-animation-time",
    "4400",
  );
  await expect(page.locator(".celebration-piece")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".callback-surface")).toHaveAttribute(
    "data-animation",
    "settled",
  );
  await page.locator("summary").click();
  await expect(
    page.getByText(callbackText("en", "accepted.helpBody")),
  ).toBeVisible();
  await evidence.check();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("both browser responses retain their content and native return-help disclosure", async ({
    page,
    baseURL,
  }) => {
    for (const accepted of [true, false]) {
      const evidence = await openCallback(page, baseURL!, "de", accepted);
      await expect(
        page.getByRole("heading", {
          name: callbackText(
            "de",
            accepted ? "accepted.title" : "rejected.title",
          ),
        }),
      ).toBeVisible();
      await page.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText(
          callbackText("de", accepted ? "accepted.helpBody" : "helpBody"),
        ),
      ).toBeVisible();
      await expect(page.locator(".celebration-piece")).toHaveCount(0);
      await evidence.check();
    }
  });
});
