import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const script = await readFile(
  new URL("./download.js", import.meta.url),
  "utf8",
);
const messages = JSON.parse(
  await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
);
const release = {
  version: "1.2.3",
  url: "https://getsituate.com/releases/1.2.3/Situate-universal.dmg",
  sha256: "ab".repeat(32),
  size: 123456,
  minimumSystemVersion: "12.0",
  architecture: "universal",
  distribution: "direct",
};

async function load(
  payload,
  {
    ok = true,
    failure = false,
    origin = "https://getsituate.com",
    browser = {},
  } = {},
) {
  const attributes = new Map([
    ["aria-disabled", "true"],
    ["tabindex", "-1"],
  ]);
  const clicks = [];
  const analytics = [];
  const link = {
    addEventListener: (event, callback) => {
      if (event === "click") clicks.push(callback);
    },
    set href(value) {
      attributes.set("href", value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const status = {
    dataset: {
      unavailable: messages["download.macosStatus"],
      available: messages["download.macosAvailable"],
      universal: messages["download.architecture.universal"],
      aarch64: messages["download.architecture.aarch64"],
      x86_64: messages["download.architecture.x86_64"],
    },
    textContent: "",
  };
  let request;
  let pageshow;
  let selectedPlatform;
  const heading = {
    textContent: "",
    dataset: { featuredTitle: "Selected platform" },
  };
  const featured = {
    hidden: true,
    append(selected) {
      selectedPlatform = selected.platform;
    },
  };
  runInNewContext(script, {
    navigator: browser,
    document: {
      querySelector(selector) {
        if (selector === ".download-featured") return featured;
        if (selector === '[data-platform="macos"]') return link;
        const match = selector.match(/^\[data-download-platform="(\w+)"\]$/);
        return match
          ? { platform: match[1], querySelector: () => heading }
          : null;
      },
      getElementById: () => status,
    },
    window: {
      situateAnalytics: {
        capture: (event, properties) =>
          analytics.push({
            event,
            properties: JSON.parse(JSON.stringify(properties)),
          }),
      },
      location: { origin },
      addEventListener: (_, callback) => {
        pageshow = callback;
      },
    },
    AbortSignal,
    URL,
    fetch: async (url, options) => {
      request = { url, options };
      if (failure) throw new Error("offline");
      return { ok, json: async () => payload };
    },
  });
  await new Promise(setImmediate);
  return {
    attributes,
    analytics,
    click: () => clicks.forEach((callback) => callback()),
    status,
    request,
    pageshow,
    selectedPlatform,
    featured,
    heading,
  };
}

test("only the available artifact link reports a download click", async () => {
  const valid = await load(release);
  valid.click();
  assert.deepEqual(valid.analytics, [
    { event: "download_clicked", properties: { version: release.version } },
  ]);
  const unavailable = await load(null);
  unavailable.click();
  assert.deepEqual(unavailable.analytics, []);
});

test("platform detection promotes one system without enabling an unavailable download", async () => {
  const profiles = [
    [
      {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
      },
      "macos",
    ],
    [
      {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        platform: "iPhone",
      },
      "ios",
    ],
    [{ userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" }, "ios"],
    [
      {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      },
      "ios",
    ],
    [
      {
        userAgent: "Mozilla/5.0 (Linux; Android 15)",
        platform: "Linux armv8l",
        userAgentData: { platform: "Linux" },
      },
      "android",
    ],
    [
      {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
      },
      "windows",
    ],
    [{ platform: "Linux x86_64" }, "linux"],
    [{ userAgentData: { platform: "macOS" } }, "macos"],
    [{ userAgentData: { platform: "Windows" } }, "windows"],
    [
      {
        userAgent: "Mozilla/5.0 (X11; CrOS x86_64)",
        platform: "Linux x86_64",
        userAgentData: { platform: "Linux" },
      },
      undefined,
    ],
    [{ userAgent: "Unknown browser", platform: "" }, undefined],
    [{}, undefined],
  ];
  for (const [browser, expected] of profiles) {
    const result = await load(null, { browser });
    assert.equal(result.selectedPlatform, expected, JSON.stringify(browser));
    assert.equal(result.featured.hidden, !expected);
    assert.equal(
      result.heading.textContent,
      expected ? "Selected platform" : "",
    );
    assert.equal(result.attributes.has("href"), false);
    assert.equal(result.attributes.get("aria-disabled"), "true");
  }
});

test("validated direct metadata enables only the canonical versioned DMG", async () => {
  for (const [architecture, label] of [
    ["universal", "Apple silicon and Intel"],
    ["aarch64", "Apple silicon"],
    ["x86_64", "Intel"],
  ]) {
    const result = await load({
      ...release,
      architecture,
      notes: "<script>ignored</script>",
    });
    assert.equal(result.attributes.get("href"), release.url);
    assert.equal(result.attributes.has("aria-disabled"), false);
    assert.equal(result.attributes.has("tabindex"), false);
    assert.equal(
      result.status.textContent,
      `Version 1.2.3 · macOS 12.0 or later · ${label}`,
    );
    assert.equal(result.request.url, "/releases/current/download.json");
    assert.equal(result.request.options.cache, "no-store");
    assert.equal(result.request.options.credentials, "omit");
    assert.equal(result.request.options.redirect, "error");
    assert.equal(result.request.options.referrerPolicy, "no-referrer");
    result.pageshow({ persisted: true });
    assert.equal(
      result.attributes.has("href"),
      false,
      "restore disables a previously validated link before rechecking",
    );
    await new Promise(setImmediate);
    assert.equal(result.attributes.get("href"), release.url);
  }
});

test("preview downloads stay bound to the preview origin", async () => {
  const preview = {
    ...release,
    url: "https://reboot.getsituate.com/releases/1.2.3/Situate-universal.dmg",
  };
  const result = await load(preview, {
    origin: "https://reboot.getsituate.com",
  });
  assert.equal(result.attributes.get("href"), preview.url);
  for (const [payload, origin] of [
    [release, "https://reboot.getsituate.com"],
    [preview, "https://getsituate.com"],
    [preview, "https://reboot.getsituate.com.evil.example"],
  ]) {
    const invalid = await load(payload, { origin });
    assert.equal(invalid.attributes.has("href"), false);
    assert.equal(invalid.attributes.get("aria-disabled"), "true");
  }
});

test("valid prerelease and build versions retain their exact artifact binding", async () => {
  const version = "2.0.0-beta.1+build-01";
  const url = `https://getsituate.com/releases/${version}/Situate-${version}-direct.dmg`;
  const result = await load({ ...release, version, url });
  assert.equal(result.attributes.get("href"), url);
  assert.match(result.status.textContent, /2\.0\.0-beta\.1\+build-01/);
});

test("unavailable, paused and malformed responses leave an honest disabled control", async () => {
  const invalid = [
    null,
    [],
    {},
    ...[
      "http://getsituate.com/releases/1.2.3/App.dmg",
      "https://evil.example/releases/1.2.3/App.dmg",
      "https://getsituate.com.evil.example/releases/1.2.3/App.dmg",
      "https://user@getsituate.com/releases/1.2.3/App.dmg",
      "https://getsituate.com:443/releases/1.2.3/App.dmg",
      "https://getsituate.com/releases/1.2.2/App.dmg",
      "https://getsituate.com/releases/1.2.3/../App.dmg",
      "https://getsituate.com/releases/1.2.3/%2e%2e.dmg",
      "https://getsituate.com/releases/1.2.3/App.dmg?track=1",
      "https://getsituate.com/releases/1.2.3/App.dmg#id",
      "javascript:alert(1)",
      "https://getsituate.com/download-counter/App.dmg",
      "https://getsituate.com/releases/1.2.3/App.dmg\n",
    ].map((url) => ({ ...release, url })),
    ...["1.2", "01.2.3", "1.2.3-01", "<img src=x onerror=alert(1)>"].map(
      (version) => ({ ...release, version }),
    ),
    { ...release, architecture: "<img src=x>" },
    { ...release, minimumSystemVersion: "<b>12.0</b>" },
    { ...release, distribution: "external" },
    { ...release, sha256: "bad" },
    { ...release, sha256: "ab".repeat(32) + "\n" },
    { ...release, minimumSystemVersion: "12.0\n" },
    ...[0, -1, "123", 1.1, Number.MAX_SAFE_INTEGER + 1].map((size) => ({
      ...release,
      size,
    })),
  ];
  for (const [payload, options] of [
    ...invalid.map((value) => [value, {}]),
    [release, { ok: false }],
    [release, { failure: true }],
  ]) {
    const { attributes, status } = await load(payload, options);
    assert.equal(attributes.has("href"), false, JSON.stringify(payload));
    assert.equal(attributes.get("aria-disabled"), "true");
    assert.equal(status.textContent, messages["download.macosStatus"]);
  }
});
