import assert from "node:assert/strict";
import { join } from "node:path";

const formId = "45818df2-b1a5-11f1-aa1c-8b3425440a79";
const endpoint = `https://eocampaign1.com/form/${formId}`;

export function providerFixture({
  missingChoices = false,
  changedContract = false,
  delayedCaptcha = false,
} = {}) {
  const script = document.querySelector("script[data-form]");
  const id = script.dataset.form;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `<p class="emailoctopus-error-message"></p><p class="emailoctopus-success-message"></p>
    <form action="https://eocampaign1.com/form/${id}">
      <input id="field_0" name="field_0" type="email" required>
      <div data-column-index="3" data-type="choice_multiple"><label>Platforms</label></div>
      <div data-column-index="4" data-type="choice_single"><label>Beta interest</label></div>
      <input type="submit" value="Subscribe">
    </form>`;
  script.after(wrapper);
  script.remove();
  const form = wrapper.querySelector("form");
  const platformField = wrapper.querySelector('[data-column-index="3"]');
  const betaField = wrapper.querySelector('[data-column-index="4"]');
  const choices = ["Windows", "Linux", "iOS", "Android"];
  platformField.dataset.choices = JSON.stringify(
    choices.map((label, index) => ({ label, value: index + 1 })),
  );
  if (changedContract) platformField.dataset.type = "choice_single";
  betaField.dataset.choices = JSON.stringify([
    { label: "yes", value: 1 },
    { label: "no", value: 2 },
  ]);
  const platformGrid = document.createElement("div");
  platformField.append(platformGrid);
  const betaGroup = document.createElement("div");
  betaField.append(betaGroup);
  const selected = new Set();
  let beta = null;
  const spans = [];
  if (!missingChoices) {
    for (const [index, label] of choices.entries()) {
      const span = document.createElement("span");
      span.setAttribute("role", "button");
      span.tabIndex = 0;
      span.textContent = label;
      span.style.cssText = "display:block;min-height:44px";
      const toggle = () => {
        if (selected.has(index + 1)) selected.delete(index + 1);
        else selected.add(index + 1);
        span.setAttribute("aria-checked", String(selected.has(index + 1)));
      };
      span.addEventListener("click", toggle);
      span.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
      const item = document.createElement("div");
      const control = document.createElement("div");
      control.append(span);
      item.append(control);
      platformGrid.append(item);
    }
    for (const [index, label] of ["yes", "no"].entries()) {
      const span = document.createElement("span");
      span.setAttribute("role", "button");
      span.setAttribute("aria-checked", "false");
      span.tabIndex = 0;
      span.textContent = label;
      span.style.cssText =
        "display:inline-block;min-height:44px;min-width:44px";
      const toggle = () => {
        beta = beta === index + 1 ? null : index + 1;
        spans.forEach((option, i) =>
          option.setAttribute("aria-checked", String(beta === i + 1)),
        );
      };
      span.addEventListener("click", toggle);
      span.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
      spans.push(span);
      const item = document.createElement("div");
      item.append(span);
      betaGroup.append(item);
    }
  }
  form.dataset.recaptchaWidgetId = "fixture-widget";
  window.completeCaptcha = () => {
    const token = document.createElement("input");
    token.type = "hidden";
    token.name = "recaptcha-response";
    form.append(token);
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  };
  window.grecaptcha = {
    execute() {
      if (!delayedCaptcha) window.completeCaptcha();
    },
    reset() {},
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.querySelector('[name="recaptcha-response"]')) {
      window.grecaptcha.execute();
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const error = wrapper.querySelector(".emailoctopus-error-message");
    error.textContent = "";
    const data = new FormData(form);
    for (const value of selected) data.append("field_3[]", value);
    if (beta !== null) data.set("field_4", beta);
    const result = await (
      await fetch(form.action, { method: "POST", body: data })
    ).json();
    if (result.success) {
      document.dispatchEvent(
        new CustomEvent("emailoctopus:form.success", {
          detail: { form_id: id },
        }),
      );
      wrapper.querySelector(".emailoctopus-success-message").textContent =
        "Thanks for subscribing!";
    } else if (result.error) {
      error.textContent = "Please try again.";
      button.disabled = false;
    }
  });
}

export async function checkWaitlist(browser, origin, proofs) {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const external = [];
    const requests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith(origin)) external.push(request.url());
    });
    await page.route("https://**/*", async (route) => {
      const request = route.request();
      if (request.url() === `${endpoint}.js`) {
        await route.fulfill({
          contentType: "text/javascript",
          body: `(${providerFixture.toString()})()`,
        });
      } else if (request.url() === endpoint && request.method() === "POST") {
        requests.push(request.postData());
        await route.fulfill({
          json: { success: true },
          headers: { "access-control-allow-origin": "*" },
        });
      } else await route.abort();
    });
    await page.goto(origin);
    assert.deepEqual(
      external,
      [],
      "no provider access before opening the form",
    );
    const section = page.locator("#platform-waitlist");
    assert.ok(await section.locator("[data-waitlist-captcha]").isHidden());
    assert.ok(await section.locator("[data-waitlist-help]").isHidden());
    assert.ok(await section.locator("[data-waitlist-subscription]").isHidden());
    assert.equal(
      await section.locator("#platform-waitlist-privacy").count(),
      0,
    );
    assert.ok((await section.boundingBox()).height < (width > 700 ? 260 : 370));
    await section.screenshot({
      path: join(proofs, `waitlist-closed-${width}.png`),
    });
    await page.locator('[data-waitlist-platform="windows"]').click();
    await page.locator('[data-waitlist-platform="ios"]').click();
    assert.deepEqual(
      external,
      [],
      "platform navigation is not consent to load providers",
    );
    await page.locator("#load-platform-waitlist").focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("textbox", { name: "Email address" })
      .waitFor({ state: "visible" });
    assert.ok(await section.locator("[data-waitlist-captcha]").isVisible());
    assert.ok(await section.locator(".waitlist-entry").isHidden());
    assert.ok(await section.locator("[data-waitlist-help]").isHidden());
    assert.ok(
      await section.locator("[data-waitlist-subscription]").isVisible(),
    );
    assert.equal(await page.locator("form").count(), 1);
    assert.equal(external.filter((url) => url === `${endpoint}.js`).length, 1);
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Windows", exact: true })
        .getAttribute("aria-checked"),
      "true",
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "iOS", exact: true })
        .getAttribute("aria-checked"),
      "true",
    );
    assert.equal(
      await page.locator('[role="radio"][aria-checked="true"]').count(),
      0,
    );
    await page
      .getByRole("textbox", { name: "Email address" })
      .fill("reader@example.invalid");
    await page
      .getByRole("checkbox", { name: "Windows", exact: true })
      .press("Space");
    await page.locator('[data-waitlist-platform="linux"]').click();
    assert.ok(
      await page
        .getByRole("checkbox", { name: "Linux", exact: true })
        .evaluate((option) =>
          option.parentElement.hasAttribute("data-waitlist-choice"),
        ),
    );
    assert.equal(
      await page.getByRole("textbox", { name: "Email address" }).inputValue(),
      "reader@example.invalid",
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Windows", exact: true })
        .getAttribute("aria-checked"),
      "false",
    );
    await page.locator('[data-waitlist-platform="linux"]').click();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Linux", exact: true })
        .getAttribute("aria-checked"),
      "true",
    );
    await page
      .getByRole("checkbox", { name: "Linux", exact: true })
      .press("Space");
    await page
      .getByRole("checkbox", { name: "iOS", exact: true })
      .press("Space");
    await page
      .getByRole("button", { name: "Join waitlist", exact: true })
      .click();
    assert.equal(requests.length, 0, "no submission without a platform");
    assert.equal(
      await page.locator("#platform-waitlist-status").innerText(),
      "Choose at least one platform.",
    );
    await page
      .getByRole("checkbox", { name: "Android", exact: true })
      .press("Space");
    await page
      .getByRole("checkbox", { name: "iOS", exact: true })
      .press("Space");
    if (width === 1440) {
      await page
        .getByRole("radio", { name: "yes", exact: true })
        .press("Space");
      await page
        .getByRole("radio", { name: "yes", exact: true })
        .press("ArrowRight");
      assert.equal(
        await page
          .getByRole("radio", { name: "no", exact: true })
          .getAttribute("aria-checked"),
        "true",
      );
      await page
        .getByRole("radio", { name: "no", exact: true })
        .press("ArrowLeft");
    }
    await page.locator("#platform-waitlist").scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({ path: join(proofs, `waitlist-form-${width}.png`) });
    await page
      .getByRole("button", { name: "Join waitlist", exact: true })
      .click();
    await page.waitForFunction(
      () => document.getElementById("platform-waitlist-form").hidden,
    );
    assert.ok(await section.locator("[data-waitlist-captcha]").isHidden());
    assert.ok(await section.locator("[data-waitlist-help]").isVisible());
    assert.equal(requests.length, 1);
    assert.match(requests[0], /name="field_3\[\]"\r\n\r\n4/);
    assert.match(requests[0], /name="field_3\[\]"\r\n\r\n3/);
    if (width === 1440) assert.match(requests[0], /name="field_4"\r\n\r\n1/);
    else assert.doesNotMatch(requests[0], /name="field_4"/);
    assert.match(
      await page.locator("#platform-waitlist-status").innerText(),
      /Check your inbox to confirm/,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: join(proofs, `waitlist-confirm-${width}.png`),
    });
    await context.close();
  }

  {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.clock.install();
    let submissions = 0;
    await page.route("https://**/*", async (route) => {
      if (route.request().url() === `${endpoint}.js`) {
        return route.fulfill({
          contentType: "text/javascript",
          body: `(${providerFixture.toString()})({delayedCaptcha:true})`,
        });
      }
      if (route.request().method() === "POST") {
        submissions++;
        return route.fulfill({
          json: { success: true },
          headers: { "access-control-allow-origin": "*" },
        });
      }
      return route.abort();
    });
    await page.goto(origin);
    await page.locator("#load-platform-waitlist").click();
    await page
      .getByRole("textbox", { name: "Email address" })
      .waitFor({ state: "visible" });
    await page
      .getByRole("textbox", { name: "Email address" })
      .fill("reader@example.invalid");
    await page.getByRole("checkbox", { name: "Windows", exact: true }).click();
    const submit = page.getByRole("button", {
      name: "Join waitlist",
      exact: true,
    });
    await submit.click();
    await page.clock.fastForward(61000);
    assert.equal(submissions, 0);
    assert.match(
      await page.locator("#platform-waitlist-status").innerText(),
      /Complete the spam check/,
    );
    assert.ok(await submit.isEnabled());
    await submit.click();
    await page.evaluate(() => window.completeCaptcha());
    await page.waitForFunction(
      () => document.getElementById("platform-waitlist-form").hidden,
    );
    assert.equal(submissions, 1);
    await context.close();
  }

  for (const scenario of [
    "script-failure",
    "missing-choices",
    "changed-contract",
    "submission-error",
    "uncertain",
  ]) {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.clock.install();
    let submissions = 0;
    await page.route("https://**/*", async (route) => {
      if (route.request().url() === `${endpoint}.js`) {
        if (scenario === "script-failure") return route.abort();
        return route.fulfill({
          contentType: "text/javascript",
          body: `(${providerFixture.toString()})(${JSON.stringify({ missingChoices: scenario === "missing-choices", changedContract: scenario === "changed-contract" })})`,
        });
      }
      if (route.request().method() === "POST") {
        submissions++;
        return route.fulfill({
          json: scenario === "uncertain" ? {} : { error: true },
          headers: { "access-control-allow-origin": "*" },
        });
      }
      return route.abort();
    });
    await page.goto(origin);
    await page.locator("#load-platform-waitlist").click();
    if (
      ["script-failure", "missing-choices", "changed-contract"].includes(
        scenario,
      )
    ) {
      await page.clock.fastForward(21000);
      await page.waitForFunction(() =>
        document
          .getElementById("platform-waitlist-status")
          .textContent.includes("could not load"),
      );
      assert.ok(await page.locator("#platform-waitlist-form").isHidden());
      assert.ok(
        await page.locator("#platform-waitlist a[href^='mailto:']").isVisible(),
      );
      assert.equal(submissions, 0);
    } else {
      await page
        .getByRole("textbox", { name: "Email address" })
        .waitFor({ state: "visible" });
      await page
        .getByRole("textbox", { name: "Email address" })
        .fill("reader@example.invalid");
      await page.getByRole("checkbox", { name: "Linux", exact: true }).click();
      await page
        .getByRole("button", { name: "Join waitlist", exact: true })
        .click();
      if (scenario === "uncertain") {
        await page.clock.fastForward(31000);
        assert.match(
          await page.locator("#platform-waitlist-status").innerText(),
          /couldn’t confirm/,
        );
        assert.ok(
          await page
            .getByRole("button", { name: "Join waitlist", exact: true })
            .isDisabled(),
        );
      } else {
        await page.getByRole("alert").waitFor({ state: "visible" });
        assert.equal(
          await page
            .getByRole("textbox", { name: "Email address" })
            .inputValue(),
          "reader@example.invalid",
        );
        assert.equal(
          await page
            .getByRole("checkbox", { name: "Linux", exact: true })
            .getAttribute("aria-checked"),
          "true",
        );
        assert.ok(
          await page
            .getByRole("button", { name: "Join waitlist", exact: true })
            .isEnabled(),
        );
        await page
          .getByRole("button", { name: "Join waitlist", exact: true })
          .click();
        await page.waitForTimeout(100);
        assert.equal(submissions, 2);
      }
    }
    await context.close();
  }
  console.log(
    "Waitlist browser checks passed (provider requests intercepted).",
  );
}
