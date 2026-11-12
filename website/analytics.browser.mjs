/* global window, document, getComputedStyle */
import assert from "node:assert/strict";
import { join } from "node:path";
import { providerFixture } from "./waitlist.browser.test.mjs";

const production = "https://getsituate.com";
const token = "phc_websiteSyntheticProjectToken12345";
const preferenceKey = "situate.website.analytics.v1";
const release = {
  version: "2.4.6",
  url: `${production}/releases/2.4.6/Situate-universal.dmg`,
  sha256: "12".repeat(32),
  size: 12345678,
  minimumSystemVersion: "12.0",
  architecture: "universal",
  distribution: "direct",
};

async function eventually(condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline)
      assert.fail("Expected analytics request was not observed");
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

export async function checkAnalytics(browser, origin, proofs) {
  async function fixture({
    configured = true,
    site = production,
    blockStorage = false,
    blockSdk = false,
    holdSdk = false,
    failIngestion = false,
    width = 390,
  } = {}) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      reducedMotion: "reduce",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    });
    await context.addInitScript(
      ({ blockStorage }) => {
        window.analyticsStorageWrites = [];
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          window.analyticsStorageWrites.push([key, value]);
          return write.call(this, key, value);
        };
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        Object.defineProperty(navigator, "userAgentData", {
          get: () => undefined,
        });
        if (blockStorage)
          Storage.prototype.setItem = () => {
            throw new Error("Storage blocked");
          };
      },
      { blockStorage },
    );
    const events = [];
    const ingestion = [];
    const sdkRequests = [];
    const unexpected = [];
    const errors = [];
    let releaseSdk;
    const sdkGate = new Promise((resolve) => {
      releaseSdk = resolve;
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === "https://eu.i.posthog.com") {
        ingestion.push(request.url());
        assert.equal(request.headers().cookie, undefined);
        assert.equal(request.headers().referer, undefined);
        assert.equal(url.pathname, "/e/", "only event ingestion is permitted");
        if (request.method() === "POST") {
          const body = request.postData();
          let data;
          try {
            data = JSON.parse(body);
          } catch {
            data = JSON.parse(
              Buffer.from(
                new URLSearchParams(body).get("data"),
                "base64",
              ).toString(),
            );
          }
          events.push(...(data.batch || (Array.isArray(data) ? data : [data])));
        }
        await route.fulfill({
          status: failIngestion ? 503 : 200,
          json: { status: 1 },
          headers: {
            "access-control-allow-origin": site,
            "access-control-allow-headers": "*",
          },
        });
      } else if (url.origin === "https://eocampaign1.com") {
        if (url.pathname.endsWith(".js"))
          await route.fulfill({
            contentType: "text/javascript",
            body: `(${providerFixture.toString()})()`,
          });
        else
          await route.fulfill({
            json: { success: true },
            headers: { "access-control-allow-origin": site },
          });
      } else if (url.origin !== site) {
        unexpected.push(request.url());
        await route.abort();
      } else if (url.pathname === "/analytics-config.js") {
        await route.fulfill({
          contentType: "text/javascript",
          body: `window.situateAnalyticsConfig = ${JSON.stringify({ token: configured ? token : "" })};`,
        });
      } else if (url.pathname === "/releases/current/download.json") {
        await route.fulfill({ json: release });
      } else {
        if (url.pathname.startsWith("/vendor/")) {
          sdkRequests.push(url.pathname);
          if (blockSdk) return route.abort();
          if (holdSdk) await sdkGate;
        }
        await route.fulfill({
          response: await route.fetch({
            url: origin + url.pathname + url.search,
          }),
        });
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const storage = () =>
      page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }));
    const grant = () =>
      page
        .getByRole("button", { name: "Allow analytics", exact: true })
        .click();
    const decline = async () => {
      await page
        .getByRole("button", { name: "Analytics preferences", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Decline analytics", exact: true })
        .click();
    };
    return {
      context,
      page,
      events,
      ingestion,
      sdkRequests,
      unexpected,
      errors,
      storage,
      grant,
      decline,
      releaseSdk,
    };
  }

  for (const width of [1440, 390, 320]) {
    const f = await fixture({ width });
    try {
      await f.context.addInitScript(() =>
        localStorage.setItem("situate.analytics.consent", "granted"),
      );
      await f.page.goto(`${production}/?email=secret-query#secret-fragment`, {
        referer: "https://source.example/path?email=secret-referrer",
      });
      assert.ok(
        await f.page.locator("[data-analytics-panel]").isVisible(),
        "legacy consent is not reused",
      );
      assert.deepEqual(f.sdkRequests, []);
      assert.deepEqual(f.ingestion, []);
      await f.page.evaluate(() =>
        window.situateAnalytics.capture("download_clicked", {
          version: "0.0.1",
        }),
      );
      assert.deepEqual(Object.keys((await f.storage()).local), [
        "situate.analytics.consent",
      ]);
      const panel = f.page.getByRole("region", {
        name: "Help improve this website",
        exact: true,
      });
      assert.ok(await panel.isVisible());
      assert.equal(await panel.getAttribute("aria-modal"), null);
      const accept = panel.getByRole("button", {
        name: "Allow analytics",
        exact: true,
      });
      const reject = panel.getByRole("button", {
        name: "Decline analytics",
        exact: true,
      });
      assert.equal(
        await accept.evaluate((element) => element === document.activeElement),
        false,
      );
      for (const button of [reject, accept]) {
        const bounds = await button.boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44);
        await button.focus();
        assert.ok(
          await button.evaluate((element) => element.matches(":focus-visible")),
        );
        assert.equal(
          await button.evaluate(
            (element) => getComputedStyle(element).outlineWidth,
          ),
          "3px",
        );
      }
      await reject.focus();
      await f.page.keyboard.press("Tab");
      assert.ok(
        await accept.evaluate((element) => element === document.activeElement),
      );
      await accept.evaluate((element) => element.blur());
      const privacyLink = panel.getByRole("link", {
        name: "How analytics works",
      });
      assert.ok(await privacyLink.isVisible());
      const privacyBounds = await privacyLink.boundingBox();
      assert.ok(
        privacyBounds.height >= 44,
        "privacy link target is at least 44px high",
      );
      await f.page
        .locator("[data-analytics-panel]")
        .screenshot({ path: join(proofs, `analytics-choice-${width}.png`) });
      assert.ok(
        await f.page
          .locator("[data-analytics-panel]")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      );
      if (width !== 390) {
        await f.page
          .getByRole("button", { name: "Decline analytics", exact: true })
          .click();
        assert.ok(
          await f.page.locator("[data-analytics-settings]").isVisible(),
        );
        await f.page.reload();
        assert.ok(
          await f.page.locator("[data-analytics-settings]").isVisible(),
        );
        assert.ok(await f.page.locator("[data-analytics-panel]").isHidden());
        assert.deepEqual(f.sdkRequests, []);
        assert.deepEqual(f.ingestion, []);
        await f.page
          .getByRole("button", { name: "Analytics preferences", exact: true })
          .click();
        await f.grant();
        await eventually(() => f.events.length === 1);
        assert.equal(f.events[0].event, "$pageview");
        assert.ok(
          await f.page.locator("[data-analytics-settings]").isVisible(),
        );
        continue;
      }
      await f.grant();
      await eventually(() => f.events.length === 1);
      assert.deepEqual(
        f.events.map((event) => event.event),
        ["$pageview"],
      );
      assert.equal(
        f.sdkRequests.length,
        1,
        "the actual pinned bundle is loaded once",
      );
      await f.page.evaluate(() => {
        window.dispatchEvent(new Event("pageshow"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await f.page.locator('[data-platform="macos"][href]').waitFor();
      await f.page.locator('[data-platform="macos"]').evaluate((link) => {
        link.addEventListener("click", (event) => event.preventDefault(), {
          once: true,
        });
        link.click();
      });
      await eventually(() => f.events.length === 2);
      assert.equal(f.events[1].event, "download_clicked");
      assert.equal(f.events[1].properties.version, release.version);
      await f.page.locator('[data-waitlist-platform="ios"]').click();
      await f.page.locator("#load-platform-waitlist").click();
      await f.page
        .getByRole("textbox", { name: "Email address" })
        .fill("synthetic-private@example.test");
      await f.page.evaluate(() =>
        document.dispatchEvent(
          new CustomEvent("emailoctopus:form.success", {
            detail: { form_id: "unrelated" },
          }),
        ),
      );
      await f.page
        .getByRole("button", { name: "Join waitlist", exact: true })
        .click();
      await eventually(() => f.events.length === 4);
      await f.page.evaluate(() =>
        document.dispatchEvent(
          new CustomEvent("emailoctopus:form.success", {
            detail: { form_id: "45818df2-b1a5-11f1-aa1c-8b3425440a79" },
          }),
        ),
      );
      assert.deepEqual(
        f.events.map((event) => event.event),
        [
          "$pageview",
          "download_clicked",
          "waitlist_form_opened",
          "waitlist_signup_reported",
        ],
      );
      assert.equal(f.events[0].properties.$referring_domain, "source.example");
      assert.equal(f.events[0].properties.$current_url, `${production}/`);
      for (const event of f.events) {
        assert.equal(event.properties.$process_person_profile, false);
        assert.equal(event.properties.$geoip_disable, true);
        assert.ok(event.properties.distinct_id);
        assert.ok(event.properties.$session_id);
        assert.equal(event.properties.surface, "website");
        assert.equal(event.properties.environment, "production");
        assert.deepEqual(
          Object.keys(event.properties).sort(),
          [
            "token",
            "distinct_id",
            "$session_id",
            "$window_id",
            "$lib",
            "$lib_version",
            "$process_person_profile",
            "$geoip_disable",
            "$host",
            "$pathname",
            "$current_url",
            "$referring_domain",
            "$device_type",
            "surface",
            "environment",
            ...(event.event === "download_clicked"
              ? ["platform", "version"]
              : []),
          ].sort(),
        );
      }
      assert.doesNotMatch(
        JSON.stringify(f.events),
        /secret-query|secret-fragment|secret-referrer|synthetic-private|utm_|\$set|\$initial/,
      );
      assert.doesNotMatch(
        JSON.stringify(await f.storage()),
        /secret-query|secret-fragment|secret-referrer|synthetic-private/,
      );
      assert.doesNotMatch(
        await f.page.evaluate(() =>
          JSON.stringify(window.analyticsStorageWrites),
        ),
        /secret-query|secret-fragment|secret-referrer|synthetic-private/,
      );
      assert.deepEqual(await f.context.cookies(), []);
      const id = f.events[0].properties.distinct_id;
      await f.page.goto(`${production}/privacy.html`);
      await eventually(() => f.events.length === 5);
      assert.equal(f.events[4].properties.$pathname, "/privacy.html");
      assert.equal(f.events[4].properties.distinct_id, id);
      const other = await f.context.newPage();
      await other.goto(`${production}/product.html`);
      await eventually(() => f.events.length === 6);
      await f.decline();
      await other.waitForFunction(
        () =>
          !Object.keys(localStorage).some((key) =>
            key.startsWith("ph_situate_website_v1"),
          ),
      );
      await other.evaluate(() =>
        window.situateAnalytics.capture("waitlist_form_opened"),
      );
      await f.page.evaluate(() =>
        window.situateAnalytics.capture("waitlist_form_opened"),
      );
      await f.page.reload();
      assert.equal(
        f.events.length,
        6,
        "withdrawal propagates across tabs and navigation",
      );
      assert.doesNotMatch(
        JSON.stringify(await f.storage()),
        /ph_situate_website_v1/,
      );
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.unexpected, []);
    } finally {
      await f.context.close();
    }
  }

  for (const options of [
    { configured: false },
    { site: "https://reboot.getsituate.com" },
    { site: origin },
  ]) {
    const f = await fixture(options);
    try {
      await f.page.goto(options.site || production);
      assert.ok(await f.page.locator("[data-analytics-panel]").isHidden());
      const settings = f.page.getByRole("button", {
        name: "Analytics preferences",
        exact: true,
      });
      assert.ok(await settings.isVisible());
      assert.deepEqual(await f.storage(), { local: {}, session: {} });
      await settings.focus();
      await f.page.keyboard.press("Enter");
      assert.ok(await f.page.locator("[data-analytics-panel]").isVisible());
      await f.page.keyboard.press("Enter");
      assert.ok(await f.page.locator("[data-analytics-panel]").isHidden());
      assert.ok(await settings.isVisible());
      assert.ok(
        await settings.evaluate((button) => document.activeElement === button),
      );
      assert.equal(
        JSON.parse((await f.storage()).local[preferenceKey]).decision,
        "denied",
      );
      await f.page.reload();
      assert.ok(await settings.isVisible());
      assert.ok(await f.page.locator("[data-analytics-panel]").isHidden());
      await f.page.goto((options.site || production) + "/privacy.html");
      assert.ok(await settings.isVisible());
      await settings.click();
      await f.grant();
      assert.ok(await settings.isVisible());
      assert.equal(
        JSON.parse((await f.storage()).local[preferenceKey]).decision,
        "granted",
      );
      assert.deepEqual(f.sdkRequests, []);
      assert.deepEqual(f.ingestion, []);
      assert.deepEqual(f.unexpected, []);
    } finally {
      await f.context.close();
    }
  }

  for (const options of [{ blockStorage: true }, { blockSdk: true }]) {
    const f = await fixture(options);
    try {
      await f.page.goto(production);
      await f.grant();
      if (options.blockStorage) {
        assert.ok(await f.page.locator("[data-analytics-error]").isVisible());
        await f.page.locator("[data-analytics-panel]").screenshot({
          path: join(proofs, "analytics-storage-error.png"),
        });
      } else await eventually(() => f.sdkRequests.length === 1);
      assert.deepEqual(f.events, []);
      assert.deepEqual(f.errors, []);
      assert.ok(
        await f.page.locator('[data-platform="macos"][href]').isVisible(),
      );
    } finally {
      await f.context.close();
    }
  }

  {
    const f = await fixture({ holdSdk: true });
    try {
      await f.page.goto(production);
      await f.grant();
      await eventually(() => f.sdkRequests.length === 1);
      await f.decline();
      f.releaseSdk();
      await f.page.waitForFunction(() => !!window.posthog);
      assert.equal(
        await f.page.evaluate(() => !!window.posthog.__loaded),
        false,
      );
      assert.deepEqual(f.ingestion, []);
      assert.doesNotMatch(
        JSON.stringify(await f.storage()),
        /ph_situate_website_v1/,
      );
    } finally {
      f.releaseSdk();
      await f.context.close();
    }
  }

  {
    const f = await fixture({ failIngestion: true });
    try {
      await f.page.goto(production);
      await f.page.clock.install();
      const failed = f.page.waitForResponse(
        (response) =>
          response.url().startsWith("https://eu.i.posthog.com/") &&
          response.status() === 503,
      );
      await f.grant();
      await (await failed).finished();
      await f.decline();
      await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
      const before = f.events.length;
      await f.page.clock.runFor(10000);
      await f.page.evaluate(() =>
        window.situateAnalytics.capture("waitlist_form_opened"),
      );
      assert.equal(f.events.length, before);
      assert.doesNotMatch(
        JSON.stringify(await f.storage()),
        /ph_situate_website_v1/,
      );
      await f.page
        .getByRole("button", { name: "Analytics preferences", exact: true })
        .click();
      await f.grant();
      await f.page.waitForLoadState("load");
      await eventually(() => f.events.length > before);
      assert.equal(
        f.events.at(-1).event,
        "$pageview",
        "re-enabling does not replay old interactions",
      );
      assert.notEqual(
        f.events.at(-1).properties.distinct_id,
        f.events[0].properties.distinct_id,
      );
    } finally {
      await f.context.close();
    }
  }

  {
    const f = await fixture();
    try {
      await f.context.addInitScript(
        ({ preferenceKey }) => {
          localStorage.setItem(
            preferenceKey,
            JSON.stringify({ decision: "granted", expires: Date.now() - 1 }),
          );
          localStorage.setItem(
            "ph_situate_website_v1",
            JSON.stringify({ distinct_id: "expired-id" }),
          );
        },
        { preferenceKey },
      );
      await f.page.goto(production);
      assert.ok(await f.page.locator("[data-analytics-panel]").isVisible());
      assert.deepEqual(f.sdkRequests, []);
      assert.doesNotMatch(JSON.stringify(await f.storage()), /expired-id/);
    } finally {
      await f.context.close();
    }
  }
}
