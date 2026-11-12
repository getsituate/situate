import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkDownload(browser, origin, proofs) {
  const release = {
    version: "2.4.6",
    url: "https://getsituate.com/releases/2.4.6/Situate-universal.dmg",
    sha256: "12".repeat(32),
    size: 12345678,
    minimumSystemVersion: "12.0",
    architecture: "universal",
    distribution: "direct",
  };
  const profiles = [390, 1440].flatMap((width) => [
    { width, siteOrigin: origin, artifactOrigin: "https://getsituate.com" },
    {
      width,
      siteOrigin: "https://reboot.getsituate.com",
      artifactOrigin: "https://reboot.getsituate.com",
    },
  ]);
  for (const { width, siteOrigin, artifactOrigin } of profiles) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const requests = [];
    const expectedRelease = {
      ...release,
      url: `${artifactOrigin}/releases/2.4.6/Situate-universal.dmg`,
    };
    let metadata = expectedRelease;
    let responseStatus = 200;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== siteOrigin) {
        requests.push(request.url());
        await route.abort();
      } else if (url.pathname === "/releases/current/download.json") {
        assert.equal(request.method(), "GET");
        assert.equal(request.headers().cookie, undefined);
        assert.equal(request.headers().referer, undefined);
        await route.fulfill({
          status: responseStatus,
          contentType: "application/json",
          body: JSON.stringify(metadata),
        });
      } else if (siteOrigin !== origin) {
        await route.fulfill({
          response: await route.fetch({
            url: origin + url.pathname + url.search,
          }),
        });
      } else {
        await route.continue();
      }
    });
    const page = await context.newPage();
    try {
      await page.goto(`${siteOrigin}/#download`);
      const link = page.getByRole("link", {
        name: "Download for macOS",
        exact: true,
      });
      await link.waitFor();
      await page.waitForFunction(() =>
        document.querySelector('[data-platform="macos"]').hasAttribute("href"),
      );
      assert.equal(await link.getAttribute("href"), expectedRelease.url);
      assert.equal(await link.isEnabled(), true);
      assert.equal(
        (await page.locator("#macos-availability").innerText()).trim(),
        "Version 2.4.6 · macOS 12.0 or later · Apple silicon and Intel",
      );
      await link.focus();
      assert.equal(
        await link.evaluate((element) => document.activeElement === element),
        true,
      );
      assert.equal(await page.locator("[data-waitlist-platform]").count(), 4);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      assert.equal(
        requests.some((url) => url.startsWith("https://getsituate.com/")),
        false,
        "metadata alone must not fetch an artifact or contact production",
      );
      for (const [payload, status] of [
        [{ ...expectedRelease, url: "https://evil.example/App.dmg" }, 200],
        [
          {
            ...expectedRelease,
            url: `${artifactOrigin === "https://getsituate.com" ? "https://reboot.getsituate.com" : "https://getsituate.com"}/releases/2.4.6/Situate-universal.dmg`,
          },
          200,
        ],
        [
          {
            ...expectedRelease,
            minimumSystemVersion: "<img src=x onerror=alert(1)>",
          },
          200,
        ],
        [{ ...expectedRelease, distribution: "external" }, 200],
        [null, 503],
        [null, 404],
      ]) {
        metadata = payload;
        responseStatus = status;
        await page.reload();
        await page.waitForLoadState("networkidle");
        assert.equal(await link.getAttribute("href"), null);
        assert.equal(await link.getAttribute("aria-disabled"), "true");
        assert.match(
          await page.locator("#macos-availability").innerText(),
          /currently unavailable/,
        );
        assert.equal(await page.locator("#macos-availability img").count(), 0);
      }
      assert.deepEqual(
        requests,
        [],
        "download discovery must not contact external services",
      );
    } finally {
      await context.close();
    }
  }

  const profilesBySystem = [
    {
      name: "macos",
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      title: "Situate for macOS",
    },
    {
      name: "ios",
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      title: "Situate for iOS",
    },
    {
      name: "ios",
      platform: "MacIntel",
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      title: "Situate for iOS",
      screenshot: "ipad",
    },
    {
      name: "windows",
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      title: "Situate for Windows",
    },
    {
      name: "android",
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 15)",
      title: "Situate for Android",
    },
    {
      name: "linux",
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      title: "Situate for Linux",
    },
    {
      name: null,
      platform: "",
      userAgent: "Unknown browser",
      screenshot: "unknown",
    },
    {
      name: null,
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; CrOS x86_64)",
      screenshot: "chromeos",
    },
    { name: null, javaScriptEnabled: false, screenshot: "no-js" },
  ];
  for (const profile of profilesBySystem) {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        userAgent: profile.userAgent,
        javaScriptEnabled: profile.javaScriptEnabled !== false,
        reducedMotion: "reduce",
      });
      await context.addInitScript(({ platform, maxTouchPoints = 0 }) => {
        Object.defineProperty(navigator, "platform", { value: platform });
        Object.defineProperty(navigator, "maxTouchPoints", {
          value: maxTouchPoints,
        });
        Object.defineProperty(navigator, "userAgentData", { value: undefined });
      }, profile);
      const external = [];
      await context.route("**/*", async (route) => {
        if (
          !route
            .request()
            .url()
            .startsWith(origin + "/")
        ) {
          external.push(route.request().url());
          await route.abort();
        } else {
          await route.continue();
        }
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(origin + "/#download");
        const featured = page.locator(".download-featured");
        assert.equal(await featured.isVisible(), Boolean(profile.name));
        assert.equal(await page.locator("[data-download-platform]").count(), 5);
        assert.equal(
          await page.locator(".download-platforms > article").count(),
          profile.name ? 4 : 5,
        );
        if (profile.name) {
          assert.equal(await featured.locator("h3").innerText(), profile.title);
          assert.equal(
            await featured
              .locator("article")
              .getAttribute("data-download-platform"),
            profile.name,
          );
          const action = featured.locator(".download-button");
          const featureBounds = await featured.boundingBox();
          const actionBounds = await action.boundingBox();
          assert.ok(
            actionBounds.x >= featureBounds.x &&
              actionBounds.x + actionBounds.width <=
                featureBounds.x + featureBounds.width + 1,
            "primary action fits the invitation",
          );
          assert.equal(
            await page.locator("#platform-waitlist-status").innerText(),
            "",
          );
          if (profile.name === "macos") {
            assert.equal(await action.getAttribute("href"), null);
            assert.equal(await action.getAttribute("aria-disabled"), "true");
          } else {
            assert.equal(
              await action.getAttribute("href"),
              "#platform-waitlist",
            );
            await action.focus();
            await page.keyboard.press("Enter");
            assert.match(
              await page.locator("#platform-waitlist-status").innerText(),
              /selected/i,
            );
            assert.equal(
              await page.locator("#platform-waitlist-form script").count(),
              0,
            );
            await page.goto(origin + "/#download");
            await page.reload();
          }
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
        );
        assert.equal(
          await page
            .locator(".download-options img, .download-options svg")
            .count(),
          0,
        );
        assert.deepEqual(external, []);
        assert.deepEqual(errors, []);
        const art = page.locator(".download-art");
        assert.equal(await art.getAttribute("aria-hidden"), "true");
        assert.equal(await art.locator('img[alt=""]').count(), 4);
        if (width <= 650) {
          const artBounds = await art.boundingBox();
          const invitationBounds = await page
            .locator(".download-invitation")
            .boundingBox();
          assert.ok(
            artBounds.y >= invitationBounds.y + invitationBounds.height,
          );
        }
        if (proofs) {
          await page
            .locator("#download")
            .evaluate((element) =>
              element.scrollIntoView({ block: "start", behavior: "instant" }),
            );
          await page.screenshot({
            path: join(
              proofs,
              `downloads-${profile.screenshot || profile.name}-${width}.png`,
            ),
          });
        }
      } finally {
        await context.close();
      }
    }
  }
}
