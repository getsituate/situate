(() => {
  "use strict";

  const open = document.getElementById("load-platform-waitlist");
  const host = document.getElementById("platform-waitlist-form");
  const status = document.getElementById("platform-waitlist-status");
  if (!open || !host || !status) return;

  const formId = "45818df2-b1a5-11f1-aa1c-8b3425440a79";
  const platforms = ["Windows", "Linux", "iOS", "Android"];
  const pending = new Set();
  const text = status.dataset;
  let state = "closed";
  let form;
  let choices = [];
  let submitTimer;
  let requestPending = false;
  let loadTimer;
  let poll;
  const section = host.closest(".platform-waitlist");
  const entry = open.closest(".waitlist-entry");
  const captchaNotice = section?.querySelector("[data-waitlist-captcha]");
  const subscriptionNotice = section?.querySelector(
    "[data-waitlist-subscription]",
  );
  const help = section?.querySelector("[data-waitlist-help]");
  if (help) help.hidden = true;
  open.hidden = false;

  function announce(message) {
    status.textContent = message;
  }

  function select(index) {
    const choice = choices[index];
    if (choice.getAttribute("aria-checked") !== "true") choice.click();
  }

  for (const link of document.querySelectorAll("[data-waitlist-platform]")) {
    link.addEventListener("click", () => {
      const index = platforms.findIndex(
        (platform) => platform.toLowerCase() === link.dataset.waitlistPlatform,
      );
      if (index < 0) return;
      if (state === "closed" || state === "loading") pending.add(index);
      if (state === "closed") {
        announce(
          text.selected.replace(
            "{platforms}",
            [...pending].map((i) => platforms[i]).join(", "),
          ),
        );
        open.focus({ preventScroll: true });
      } else if (state === "ready") {
        select(index);
        choices[index].focus({ preventScroll: true });
      }
    });
  }

  function stopLoading() {
    clearInterval(poll);
    clearTimeout(loadTimer);
    host.removeAttribute("aria-busy");
  }

  function fail() {
    stopLoading();
    state = "failed";
    host.hidden = true;
    open.hidden = true;
    if (entry) entry.hidden = true;
    if (captchaNotice) captchaNotice.hidden = true;
    if (help) help.hidden = false;
    announce(text.failed);
  }

  function finishRequest() {
    requestPending = false;
    clearTimeout(submitTimer);
    submitTimer = undefined;
    host.removeAttribute("aria-busy");
  }

  async function prepare() {
    const candidate = host.querySelector("form");
    const platformField = host.querySelector('[data-column-index="3"]');
    const betaField = host.querySelector('[data-column-index="4"]');
    const options = [
      ...(platformField?.querySelectorAll('[role="button"]') || []),
    ];
    const betaOptions = [
      ...(betaField?.querySelectorAll('[role="button"][aria-checked]') || []),
    ];
    if (!candidate || options.length !== 4 || betaOptions.length !== 2) return;
    // The embed mounts choices and CAPTCHA asynchronously after its script loads.
    if (!candidate.dataset.recaptchaWidgetId || !window.grecaptcha?.execute)
      return;
    const contract = JSON.parse(platformField.dataset.choices || "[]");
    const betaContract = JSON.parse(betaField.dataset.choices || "[]");
    if (
      platformField.dataset.type !== "choice_multiple" ||
      contract.length !== platforms.length ||
      contract.some(
        (entry, index) =>
          entry.label !== platforms[index] || entry.value !== index + 1,
      ) ||
      betaField.dataset.type !== "choice_single" ||
      betaContract.length !== 2 ||
      betaContract[0].label !== "yes" ||
      betaContract[0].value !== 1 ||
      betaContract[1].label !== "no" ||
      betaContract[1].value !== 2
    ) {
      fail();
      return;
    }
    form = candidate;
    choices = options;
    stopLoading();
    state = "ready";
    const email = form.querySelector('input[type="email"]');
    const submit = form.querySelector('[type="submit"]');
    if (!email || !submit) return fail();
    email.autocomplete = "email";
    email.inputMode = "email";
    email.setAttribute("aria-label", text.email);
    const label = document.createElement("label");
    label.htmlFor = email.id;
    label.textContent = text.email;
    email.before(label);
    if (submit instanceof HTMLInputElement) submit.value = text.submit;
    else submit.textContent = text.submit;
    platformField.querySelector("label").textContent = text.platforms;
    betaField.querySelector("label").textContent = text.beta;
    platformField.dataset.waitlistPlatforms = "";
    betaField.dataset.waitlistBeta = "";
    const choiceGrid = choices[0].parentElement.parentElement.parentElement;
    choiceGrid.dataset.waitlistChoices = "";
    for (const option of choices)
      option.parentElement.dataset.waitlistChoice = "";
    betaOptions[0].parentElement.parentElement.dataset.waitlistBetaOptions = "";
    for (const option of betaOptions)
      option.parentElement.dataset.waitlistBetaOption = "";
    platformField.setAttribute("role", "group");
    platformField.setAttribute("aria-label", text.platforms);
    betaField.setAttribute("role", "radiogroup");
    betaField.setAttribute("aria-label", text.beta);
    for (const [index, option] of choices.entries()) {
      option.setAttribute("role", "checkbox");
      option.setAttribute("aria-label", platforms[index]);
      if (!option.hasAttribute("aria-checked"))
        option.setAttribute("aria-checked", "false");
    }
    for (const input of platformField.querySelectorAll(
      'input[type="checkbox"]',
    )) {
      input.setAttribute("aria-hidden", "true");
      input.tabIndex = -1;
    }
    for (const [index, option] of betaOptions.entries()) {
      option.setAttribute("role", "radio");
      option.setAttribute("aria-label", betaContract[index].label);
      option.addEventListener("keydown", (event) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        const other = betaOptions[1 - index];
        if (other.getAttribute("aria-checked") !== "true") other.click();
        other.focus();
      });
    }
    const providerError = host.querySelector(".emailoctopus-error-message");
    const providerSuccess = host.querySelector(".emailoctopus-success-message");
    if (providerSuccess) providerSuccess.hidden = true;
    if (providerError) {
      providerError.setAttribute("role", "alert");
      new MutationObserver(() => {
        if (providerError.textContent.trim()) {
          finishRequest();
          form.querySelector('[name="recaptcha-response"]')?.remove();
          window.grecaptcha.reset(form.dataset.recaptchaWidgetId);
          if (help) help.hidden = false;
          announce("");
        }
      }).observe(providerError, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    form.addEventListener(
      "submit",
      (event) => {
        const hasToken = Boolean(
          form.querySelector('[name="recaptcha-response"]'),
        );
        if (state !== "ready" || requestPending) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (
          !choices.some(
            (choice) => choice.getAttribute("aria-checked") === "true",
          )
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          platformField.setAttribute("aria-invalid", "true");
          platformField.setAttribute("aria-describedby", status.id);
          announce(text.required);
          choices[0].focus();
          return;
        }
        platformField.removeAttribute("aria-invalid");
        platformField.removeAttribute("aria-describedby");
        if (!hasToken) {
          announce(text.verifying);
          return;
        }
        requestPending = true;
        announce(text.sending);
        host.setAttribute("aria-busy", "true");
        submitTimer = setTimeout(() => {
          host.removeAttribute("aria-busy");
          submit.disabled = true;
          if (help) help.hidden = false;
          announce(text.uncertain);
        }, 30000);
      },
      true,
    );
    for (const index of pending) {
      select(index);
      await Promise.resolve();
    }
    pending.clear();
    host.hidden = false;
    open.hidden = true;
    if (entry) entry.hidden = true;
    if (subscriptionNotice) subscriptionNotice.hidden = false;
    announce("");
    email.focus({ preventScroll: true });
  }

  document.addEventListener("emailoctopus:form.success", (event) => {
    if (event.detail?.form_id !== formId || state !== "ready") return;
    finishRequest();
    state = "confirmed";
    void window.situateAnalytics?.capture("waitlist_signup_reported");
    host.hidden = true;
    if (captchaNotice) captchaNotice.hidden = true;
    if (subscriptionNotice) subscriptionNotice.hidden = true;
    if (help) help.hidden = false;
    announce(text.confirm);
  });

  open.addEventListener("click", () => {
    if (state !== "closed") return;
    state = "loading";
    void window.situateAnalytics?.capture("waitlist_form_opened");
    open.disabled = true;
    if (captchaNotice) captchaNotice.hidden = false;
    host.setAttribute("aria-busy", "true");
    announce(text.loading);
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://eocampaign1.com/form/${formId}.js`;
    script.dataset.form = formId;
    script.onerror = fail;
    host.appendChild(script);
    loadTimer = setTimeout(fail, 20000);
    poll = setInterval(() => {
      void prepare().catch(fail);
    }, 100);
  });
})();
