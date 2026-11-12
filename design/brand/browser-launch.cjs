"use strict";

function launchBrowser(chromium, options) {
  if (options.channel || options.executablePath)
    return chromium.launch(options);
  // Full Chrome's Crashpad can retain Playwright's pipes after browser exit on Linux.
  // The bundled headless shell uses the same pinned Chromium without that handler.
  const channel =
    process.platform === "linux" && options.headless !== false
      ? "chromium-headless-shell"
      : "chromium";
  return chromium.launch({ ...options, channel });
}

module.exports = { launchBrowser };
