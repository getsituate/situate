(() => {
  "use strict";

  const origin = "https://getsituate.com";
  const preferenceKey = "situate.website.analytics.v1";
  const namespace = "situate_website_v1";
  const identityKey = `ph_${namespace}_identity`;
  const lifetime = 180 * 24 * 60 * 60 * 1000;
  const token = window.situateAnalyticsConfig?.token;
  const panel = document.querySelector("[data-analytics-panel]");
  const settings = document.querySelector("[data-analytics-settings]");
  if (!panel || !settings) return;

  let sdk;
  let loading;
  let controller;
  let generation = 0;
  let stopped = false;
  let blocked = false;
  let viewed = false;
  let expiryTimer;

  function preference() {
    try {
      const value = JSON.parse(localStorage.getItem(preferenceKey));
      if (
        ["granted", "denied"].includes(value?.decision) &&
        Number.isFinite(value.expires) &&
        value.expires > Date.now() &&
        value.expires <= Date.now() + lifetime
      )
        return value;
    } catch {
      // Unavailable or malformed storage never grants consent.
    }
    return null;
  }

  const enabled =
    window.location.origin === origin &&
    typeof token === "string" &&
    /^phc_[A-Za-z0-9]{20,200}$/.test(token);
  const allowed = () =>
    enabled && !blocked && preference()?.decision === "granted";

  function clearIdentity() {
    for (const name of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[name];
        for (const key of Object.keys(storage)) {
          if (key.startsWith(`ph_${namespace}`)) storage.removeItem(key);
        }
      } catch {
        // Analytics stay blocked even when storage cannot be cleared.
      }
    }
  }

  function stop() {
    generation += 1;
    loading = undefined;
    clearTimeout(expiryTimer);
    controller?.abort();
    if (sdk) {
      stopped = true;
      try {
        sdk.opt_out_capturing();
        sdk.set_config({ disable_persistence: true });
        // The aborted fetch signal and disabled beacons prevent teardown from sending buffered events.
        void sdk.shutdown();
      } catch {
        // Withdrawal must not depend on the SDK completing cleanup.
      }
      sdk = undefined;
    }
    clearIdentity();
    viewed = false;
  }

  function pagePath() {
    return [
      "/",
      "/product.html",
      "/privacy.html",
      "/legal-notice.html",
    ].includes(location.pathname)
      ? location.pathname
      : "/";
  }

  function referringDomain() {
    try {
      const referrer = new URL(document.referrer);
      if (
        ["http:", "https:"].includes(referrer.protocol) &&
        referrer.origin !== origin
      )
        return referrer.hostname;
    } catch {
      // An absent referrer is a direct visit.
    }
    return "$direct";
  }

  function sanitize(event) {
    if (
      !allowed() ||
      ![
        "$pageview",
        "download_clicked",
        "waitlist_form_opened",
        "waitlist_signup_reported",
      ].includes(event.event)
    )
      return null;
    const properties = event.properties;
    const safe = {
      token,
      distinct_id: properties.distinct_id,
      $session_id: properties.$session_id,
      $window_id: properties.$window_id,
      $lib: "web",
      $lib_version: "1.447.4",
      $process_person_profile: false,
      $geoip_disable: true,
      $host: "getsituate.com",
      $pathname: pagePath(),
      $current_url: origin + pagePath(),
      $referring_domain: referringDomain(),
      $device_type: ["Desktop", "Mobile", "Tablet"].includes(
        properties.$device_type,
      )
        ? properties.$device_type
        : "Desktop",
      surface: "website",
      environment: "production",
    };
    if (event.event === "download_clicked") {
      if (
        typeof properties.version !== "string" ||
        !/^[0-9A-Za-z.+-]{1,100}$/.test(properties.version)
      )
        return null;
      safe.platform = "macos";
      safe.version = properties.version;
    }
    return {
      event: event.event,
      properties: safe,
      timestamp: event.timestamp,
      uuid: event.uuid,
    };
  }

  async function start() {
    if (!allowed()) return;
    if (sdk) return sdk;
    if (loading) return loading;
    const current = generation;
    loading = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "/vendor/posthog-1.447.4.min.js";
      script.async = true;
      script.onload = () => {
        try {
          if (current !== generation || !allowed()) return resolve();
          controller = new AbortController();
          const identity = localStorage.getItem(identityKey);
          sdk = window.posthog.init(token, {
            api_host: "https://eu.i.posthog.com",
            ui_host: "https://eu.posthog.com",
            // SDK persistence also retains raw entry/referrer URLs; persist only its generated browser ID.
            persistence: "memory",
            bootstrap: /^[0-9a-f-]{36}$/.test(identity || "")
              ? { distinctID: identity, isIdentifiedID: false }
              : {},
            persistence_name: namespace,
            consent_persistence_name: `ph_${namespace}_consent`,
            cross_subdomain_cookie: false,
            person_profiles: "never",
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            capture_heatmaps: false,
            capture_dead_clicks: false,
            rageclick: false,
            capture_exceptions: false,
            capture_performance: false,
            capture_web_vitals: false,
            enable_recording_console_log: false,
            disable_session_recording: true,
            disable_surveys: true,
            disable_conversations: true,
            disable_product_tours: true,
            disable_web_experiments: true,
            disable_external_dependency_loading: true,
            advanced_disable_flags: true,
            opt_in_site_apps: false,
            save_campaign_params: false,
            save_referrer: false,
            mask_personal_data_properties: true,
            disable_capture_url_hashes: true,
            get_current_url: () => origin + pagePath(),
            ip: false,
            debug: false,
            request_batching: false,
            disable_compression: true,
            disable_beacon: true,
            api_transport: "fetch",
            fetch_options: {
              signal: controller.signal,
              credentials: "omit",
              referrerPolicy: "no-referrer",
            },
            before_send: sanitize,
          });
          localStorage.setItem(identityKey, sdk.get_distinct_id());
          resolve(sdk);
        } catch {
          stop();
          resolve();
        }
      };
      script.onerror = () => resolve();
      document.head.append(script);
    });
    return loading;
  }

  async function capture(event, properties = {}) {
    if (!allowed()) return;
    const current = generation;
    try {
      const client = await start();
      if (client && allowed() && current === generation)
        client.capture(event, properties);
    } catch {
      // Analytics must not interrupt the visitor's action.
    }
  }
  window.situateAnalytics = { capture };

  function pageview() {
    if (!allowed() || viewed) return;
    viewed = true;
    void capture("$pageview");
  }

  function sync() {
    if (!allowed()) stop();
    if (enabled && !preference()) panel.hidden = false;
    if (allowed()) {
      const remaining = preference().expires - Date.now();
      // Long browser timers overflow after roughly 25 days.
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(sync, Math.min(remaining, 24 * 60 * 60 * 1000));
      pageview();
    }
  }

  function choose(decision) {
    blocked = decision !== "granted";
    if (blocked) stop();
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({ decision, expires: Date.now() + lifetime }),
      );
    } catch {
      blocked = true;
      stop();
      panel.querySelector("[data-analytics-error]").hidden = false;
      return;
    }
    panel.hidden = true;
    settings.focus({ preventScroll: true });
    if (decision === "granted" && stopped) {
      location.reload();
      return;
    }
    if (decision === "granted") {
      loading = undefined;
      sync();
    }
  }

  panel
    .querySelector("[data-analytics-accept]")
    .addEventListener("click", () => choose("granted"));
  panel
    .querySelector("[data-analytics-decline]")
    .addEventListener("click", () => choose("denied"));
  settings.hidden = false;
  settings.addEventListener("click", () => {
    panel.hidden = false;
    panel.querySelector("[data-analytics-decline]").focus();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      panel.hidden = true;
      settings.focus({ preventScroll: true });
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === preferenceKey || event.key === null) {
      blocked = false;
      if (allowed() && stopped) location.reload();
      else sync();
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      viewed = false;
      sync();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sync();
  });
  sync();
})();
