(() => {
  function currentPlatform() {
    const { userAgent = "", platform = "", maxTouchPoints = 0 } = navigator;
    if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
    // iPadOS can request desktop sites with a macOS user agent.
    if (platform === "MacIntel" && maxTouchPoints > 1) return "ios";
    if (/Android/i.test(userAgent)) return "android";
    if (/CrOS/i.test(userAgent)) return null;
    const system = navigator.userAgentData?.platform || platform || userAgent;
    if (/Mac/i.test(system)) return "macos";
    if (/Win/i.test(system)) return "windows";
    if (/Linux/i.test(system)) return "linux";
    return null;
  }

  const featured = document.querySelector(".download-featured");
  const platform = currentPlatform();
  const selected = platform
    ? document.querySelector(`[data-download-platform="${platform}"]`)
    : null;
  if (featured && selected) {
    const heading = selected.querySelector("h3");
    heading.textContent = heading.dataset.featuredTitle;
    featured.append(selected);
    featured.hidden = false;
  }

  const link = document.querySelector('[data-platform="macos"]');
  const status = document.getElementById("macos-availability");
  if (!link || !status) return;

  function validRelease(release) {
    if (!release || typeof release !== "object") return false;
    const version = release.version;
    const semver =
      typeof version === "string" &&
      /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
        version,
      );
    if (
      !semver ||
      version !== version.trim() ||
      semver[1]?.split(".").some((part) => /^0\d+$/.test(part)) ||
      release.distribution !== "direct" ||
      !["universal", "aarch64", "x86_64"].includes(release.architecture) ||
      typeof release.minimumSystemVersion !== "string" ||
      !/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(release.minimumSystemVersion) ||
      release.minimumSystemVersion !== release.minimumSystemVersion.trim() ||
      typeof release.sha256 !== "string" ||
      release.sha256.length !== 64 ||
      !/^[a-fA-F0-9]{64}$/.test(release.sha256) ||
      !Number.isSafeInteger(release.size) ||
      release.size <= 0 ||
      typeof release.url !== "string"
    )
      return false;
    const origin =
      window.location?.origin === "https://reboot.getsituate.com"
        ? "https://reboot.getsituate.com"
        : "https://getsituate.com";
    const prefix = `${origin}/releases/${version}/`;
    return (
      new URL(release.url).href === release.url &&
      release.url.startsWith(prefix) &&
      /^[A-Za-z0-9][A-Za-z0-9._+-]*\.dmg$/.test(
        release.url.slice(prefix.length),
      )
    );
  }

  let availableVersion;
  link.addEventListener("click", () => {
    if (availableVersion)
      void window.situateAnalytics?.capture("download_clicked", {
        version: availableVersion,
      });
  });

  async function refresh() {
    availableVersion = undefined;
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("tabindex", "-1");
    status.textContent = status.dataset.unavailable;
    try {
      const response = await fetch("/releases/current/download.json", {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return;
      const release = await response.json();
      if (!validRelease(release)) return;
      const architecture = status.dataset[release.architecture];
      status.textContent = status.dataset.available.replace(
        /\{(version|minimumSystemVersion|architecture)\}/g,
        (_, key) => (key === "architecture" ? architecture : release[key]),
      );
      availableVersion = release.version;
      link.href = release.url;
      link.removeAttribute("aria-disabled");
      link.removeAttribute("tabindex");
    } catch {
      // Leave the download unavailable when metadata cannot be validated.
    }
  }

  void refresh();
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void refresh();
  });
})();
