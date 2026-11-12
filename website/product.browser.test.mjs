import assert from "node:assert/strict";
import { join } from "node:path";

async function inspectIntroduction(page, { fitBenefits = true } = {}) {
  assert.equal(
    (await page.locator("#product-title").innerText())
      .replace(/\s+/g, " ")
      .trim(),
    "An organization app that adapts to you. Not the other way around.",
  );
  const benefits = page.locator(".product-benefits");
  for (const title of [
    "Work your way.",
    "Get help with the work.",
    "Stay independent.",
  ])
    assert.ok(
      await benefits
        .getByRole("heading", { name: title, exact: true })
        .isVisible(),
    );
  assert.equal(await benefits.getByRole("heading").count(), 3);
  assert.deepEqual(
    await benefits
      .locator("a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
    ["#plugins", "#space", "#choices"],
  );
  assert.match(
    await page.locator(".workstyle-example blockquote").innerText(),
    /I keep tasks in my project notes/,
  );
  assert.deepEqual(
    await page.locator(".example-task").allTextContents(),
    await page.locator(".example-overview li > span").allTextContents(),
  );
  assert.deepEqual(
    await page.locator(".example-source").allTextContents(),
    await page.locator(".example-overview small").allTextContents(),
  );
  assert.deepEqual(
    await page
      .locator("main > section")
      .evaluateAll((sections) =>
        sections.map((section) => section.classList[0]),
      ),
    ["product-intro", "plugins", "space", "models", "free", "ending"],
  );
  assert.equal(await page.locator("#choices .open-source").count(), 1);
  assert.match(await page.locator("#choices").innerText(), /Markdown files/);
  assert.match(
    await page.locator(".model-processing").innerText(),
    /Cloud AI processes the content/,
  );
  const layout = await page.evaluate(() => {
    const rect = (selector) =>
      document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      width: innerWidth,
      height: innerHeight,
      copy: rect(".product-intro-copy"),
      benefits: rect(".product-benefits"),
      example: rect(".workstyle-example"),
      items: [...document.querySelectorAll(".product-benefits li")].map(
        (element) => element.getBoundingClientRect().toJSON(),
      ),
      animations: document
        .querySelector(".product-intro")
        .getAnimations({ subtree: true }).length,
    };
  });
  assert.ok(layout.copy.bottom < layout.benefits.top);
  if (fitBenefits) assert.ok(layout.benefits.bottom <= layout.height);
  if (layout.width <= 1100) {
    assert.ok(layout.example.top > layout.benefits.bottom);
  } else {
    assert.ok(layout.example.left > layout.copy.right);
    assert.ok(layout.example.bottom < layout.benefits.top);
  }
  assert.equal(layout.animations, 0);
  for (const [index, item] of layout.items.entries()) {
    assert.ok(item.left >= 0 && item.right <= layout.width);
    if (index === 0) continue;
    const previous = layout.items[index - 1];
    if (layout.width <= 900) assert.ok(item.top > previous.bottom);
    else {
      assert.equal(item.top, previous.top);
      assert.ok(item.left > previous.right);
    }
  }
}

export async function checkProduct(browser, origin, proofs, inspect) {
  for (const width of [1440, 1280, 1101, 1100, 768, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const failures = [];
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("request", (request) => {
        if (!request.url().startsWith(origin)) failures.push(request.url());
      });
      page.on("response", (response) => {
        if (
          response.status() >= 400 &&
          !(
            response.status() === 404 &&
            response.url() === `${origin}/releases/current/download.json`
          )
        )
          failures.push(response.url());
      });
      await page.goto(`${origin}/product.html`);
      await inspect(page, `product/${width}`);
      await inspectIntroduction(page);
      await page.screenshot({
        path: join(proofs, `product-intro-${width}.png`),
      });
      assert.equal(
        await page.locator(".header [aria-current=page]").count(),
        2,
      );
      assert.equal(await page.locator(".screen-viewer").count(), 1);
      assert.equal(await page.locator("#platform-waitlist").count(), 0);
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector(".plugin-aside").getBoundingClientRect()
              .top >=
            document.querySelector(".plugin-screen").getBoundingClientRect()
              .bottom,
        ),
      );
      await page.screenshot({
        path: join(proofs, `product-${width}.png`),
        fullPage: true,
      });
      await page.locator(".workstyle-example").screenshot({
        path: join(proofs, `product-example-${width}.png`),
      });

      const tabs = page.getByRole("tab");
      assert.equal(await tabs.count(), 3);
      await tabs.first().focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
      assert.ok(await page.locator("#panel-documents").isVisible());
      assert.ok(await page.locator("#panel-notes").isHidden());
      await page.keyboard.press("End");
      assert.equal(await tabs.last().getAttribute("aria-selected"), "true");
      await page.keyboard.press("ArrowRight");
      assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
      await page.keyboard.press("ArrowLeft");
      assert.equal(await tabs.last().getAttribute("aria-selected"), "true");
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await inspect(page, `product/documents-${width}`);
      const opener = page.locator("#panel-documents a");
      await opener.focus();
      await page.keyboard.press("Enter");
      assert.ok(await page.getByRole("dialog").isVisible());
      assert.ok(
        (await page.locator(".viewer-canvas img").getAttribute("src")).endsWith(
          "/documents.webp",
        ),
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.documentElement.style.overflow === "",
      );
      assert.ok(
        await opener.evaluate((element) => element === document.activeElement),
      );

      for (const id of ["plugins", "space", "choices"]) {
        const chapter = page.locator(`.product-contents a[href="#${id}"]`);
        await chapter.focus();
        await page.keyboard.press("Enter");
        assert.equal(new URL(page.url()).hash, `#${id}`);
        assert.ok(
          await page
            .locator(`#${id}`)
            .evaluate(
              (element) =>
                element.getBoundingClientRect().top >=
                document.querySelector(".header").getBoundingClientRect()
                  .bottom,
            ),
        );
      }
      assert.equal(
        await page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((animation) => animation.playState === "running").length,
        ),
        0,
      );
      await page.locator(".ending .button").click();
      await page.waitForURL(`${origin}/#download`);
      assert.equal(await page.locator("[data-download-platform]").count(), 5);
      assert.equal(
        await page.locator('.download-button[aria-disabled="true"]').count(),
        1,
      );
      await page.goBack();
      await page.waitForURL(`${origin}/product.html#choices`);
      await page.locator(".header .wordmark").click();
      await page.waitForURL(`${origin}/`);
      await page.locator(".overview a").focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(`${origin}/product.html`);
      await page.goBack();
      await page.waitForURL(`${origin}/`);
      if (width <= 900) await page.locator(".mobile-menu summary").click();
      await page.locator('.header nav:visible a[href="/product.html"]').click();
      await page.waitForURL(`${origin}/product.html`);
      assert.ok(
        !(await page.locator(".mobile-menu").evaluate((menu) => menu.open)),
      );
      if (width <= 900) await page.locator(".mobile-menu summary").click();
      await page.locator('.header nav:visible a[href="/"]').click();
      await page.waitForURL(`${origin}/`);
      assert.ok(
        !(await page.locator(".mobile-menu").evaluate((menu) => menu.open)),
      );
      await page.goBack();
      await page.waitForURL(`${origin}/product.html`);
      if (width <= 900) await page.locator(".mobile-menu summary").click();
      await page.locator(".nav-action").click();
      await page.waitForURL(`${origin}/#download`);
      assert.deepEqual(failures, []);
    } finally {
      await context.close();
    }
  }

  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/product.html`);
      await inspect(page, `product/no-js-${width}`);
      await inspectIntroduction(page);
      assert.ok(await page.locator(".screen-tabs").isHidden());
      assert.equal(await page.locator(".screen-panel").count(), 3);
      for (const panel of await page.locator(".screen-panel").all())
        assert.ok(await panel.isVisible());
      await page.locator('.product-contents a[href="#choices"]').click();
      assert.equal(new URL(page.url()).hash, "#choices");
      await page.locator(".ending .button").click();
      await page.waitForURL(`${origin}/#download`);
    } finally {
      await context.close();
    }
  }

  // macOS WebKit uses Option-Tab to include links in the focus order.
  const linkTabModifier =
    process.platform === "darwin" && browser.browserType().name() === "webkit"
      ? "Alt+"
      : "";
  for (const viewport of [
    { width: 960, height: 600 },
    { width: 568, height: 320 },
    { width: 390, height: 667 },
    { width: 320, height: 568 },
  ]) {
    const compact = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    try {
      const page = await compact.newPage();
      await page.goto(`${origin}/product.html`);
      await inspect(
        page,
        `product/compact-${viewport.width}x${viewport.height}`,
      );
      await inspectIntroduction(page, { fitBenefits: false });
      for (const link of await page.locator(".product-benefits a").all()) {
        await link.focus();
        await page.keyboard.press(`${linkTabModifier}Tab`);
        await page.keyboard.press(`${linkTabModifier}Shift+Tab`);
        assert.ok(
          await link.evaluate(
            (element) =>
              element === document.activeElement &&
              getComputedStyle(element).outlineStyle !== "none",
          ),
        );
      }
      await page.locator('.product-contents a[href="#plugins"]').press("Enter");
      assert.equal(new URL(page.url()).hash, "#plugins");
      await page.locator(".workstyle-example").screenshot({
        path: join(
          proofs,
          `product-example-${viewport.width}x${viewport.height}.png`,
        ),
      });
    } finally {
      await compact.close();
    }
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/product.html`);
    await inspectIntroduction(page);
    await page.goto(`${origin}/product.html#plugins`);
    await page
      .locator(".plugin-stage")
      .evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
    await page.waitForFunction(() =>
      document
        .querySelector(".plugins")
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === "running"),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        !document
          .getAnimations()
          .some((animation) => animation.playState === "running"),
    );
    await page.screenshot({ path: join(proofs, "product-plugins-still.png") });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator(".product-intro").scrollIntoViewIfNeeded();
    await page.locator(".plugin-stage").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector(".plugins").getAnimations({ subtree: true })
            .length,
      ),
      0,
    );
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector(".plugin-bend svg"),
    );
    await inspect(page, "product/reload");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  const fallback = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    await fallback.addInitScript(() => {
      delete window.IntersectionObserver;
    });
    const page = await fallback.newPage();
    await page.goto(`${origin}/product.html`);
    await inspect(page, "product/no-observer");
    await inspectIntroduction(page);
    assert.equal(await page.getByRole("tab").count(), 3);
    await page.getByRole("tab").last().click();
    assert.ok(await page.locator("#panel-workspace").isVisible());
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  } finally {
    await fallback.close();
  }
  console.log(
    "Product browser checks passed: introduction, navigation, gallery, image viewer, motion, no-JS and observer fallback.",
  );
}
