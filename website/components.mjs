export const menuLinks = [
  { href: "/", key: "nav.index" },
  { href: "/product.html", key: "nav.product" },
];

export const legalLinks = [
  { href: "/legal-notice.html", key: "footer.legal" },
  { href: "/privacy.html", key: "footer.privacy" },
];

export function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

export function translator(messages) {
  return (key) => {
    if (typeof messages[key] !== "string")
      throw new Error(`Missing translation: ${key}`);
    return escapeHtml(messages[key]);
  };
}

export function renderHeader(
  messages,
  { home = false, progress = false, pathname = "/" } = {},
) {
  const text = translator(messages);
  const destination = (href) =>
    home && href.startsWith("/#") ? href.slice(1) : href;
  const links = menuLinks
    .map(
      ({ href, key }) =>
        `<li><a href="${destination(href)}"${pathname === href ? ' aria-current="page"' : ""}>${text(key)}</a></li>`,
    )
    .join("");
  return `<header class="header">
  <div class="header-inner">
    <a class="wordmark" href="/" aria-label="${text("nav.home")}"><img src="/design/brand/assets/wordmark.svg" width="142" height="44" alt="${text("brand")}"></a>
    <nav class="desktop-nav" aria-label="${text("nav.label")}"><ul class="site-links">${links}</ul></nav>
    <div class="header-actions">
      <a class="nav-action" href="${destination("/#download")}">${text("nav.action")} <span aria-hidden="true">↓</span></a>
      <details class="mobile-menu">
        <summary><span class="menu-open-label">${text("nav.menu")}</span><span class="menu-close-label">${text("nav.close")}</span><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path class="menu-bars" d="M4 8h16M4 16h16"/><path class="menu-cross" d="m6 6 12 12M6 18 18 6"/></svg></summary>
        <nav aria-label="${text("nav.label")}"><ul class="site-links">${links}</ul></nav>
      </details>
    </div>
  </div>
  ${progress ? '<div class="page-progress" aria-hidden="true"></div>' : ""}
</header>`;
}

export function renderFooter(messages, { pathname = "/" } = {}) {
  const text = translator(messages);
  return `<footer class="site-footer">
  <div><a class="wordmark" href="/" aria-label="${text("nav.home")}"><img src="/design/brand/assets/wordmark.svg" width="140" height="44" alt="${text("brand")}"></a><p>${text("footer.line")}</p></div>
  <nav aria-label="${text("footer.navigation")}">
    ${legalLinks.map(({ href, key }) => `<a href="${href}"${pathname === href ? ' aria-current="page"' : ""}>${text(key)}</a>`).join("\n    ")}
    <button type="button" data-analytics-settings hidden>${text("analytics.settings")}</button>
    <a href="#top">${text("footer.top")} <span aria-hidden="true">↑</span></a>
  </nav>
</footer>
<div class="analytics-panel" data-analytics-panel role="region" aria-labelledby="analytics-title" hidden>
  <div class="analytics-heading">
    <p class="analytics-category">${text("analytics.category")}</p>
    <h2 id="analytics-title">${text("analytics.title")}</h2>
  </div>
  <div class="analytics-content">
  <p>${text("analytics.body")}</p>
  <p class="analytics-details">${text("analytics.details")} <a href="/privacy.html#cookies-and-external-content">${text("analytics.privacy")}</a></p>
  <p data-analytics-error role="status" hidden>${text("analytics.storageError")}</p>
  <div class="analytics-actions">
    <button type="button" data-analytics-decline>${text("analytics.decline")}</button>
    <button type="button" data-analytics-accept>${text("analytics.accept")}</button>
  </div>
  </div>
</div>
<script src="/analytics-config.js" defer></script>
<script src="/analytics.js" defer></script>`;
}

export function renderViewer(messages) {
  const text = translator(messages);
  return `<dialog class="screen-viewer" aria-labelledby="viewer-title">
      <div class="viewer-header">
        <h2 id="viewer-title">${text("viewer.title")}</h2>
        <div>
          <button
            type="button"
            class="viewer-zoom"
            data-zoom="${text("viewer.zoom")}"
            data-fit="${text("viewer.fit")}"
          >
            ${text("viewer.zoom")}</button
          ><button
            type="button"
            class="viewer-close"
            aria-label="${text("viewer.close")}"
          >
            <span>${text("viewer.close")}</span>
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </div>
      <div
        class="viewer-canvas"
        tabindex="0"
        role="region"
        aria-label="${text("viewer.area")}"
      >
        <img alt="" width="1440" height="940" />
      </div>
    </dialog>`;
}
