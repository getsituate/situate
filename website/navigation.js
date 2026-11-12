(() => {
  const header = document.querySelector(".header");
  const menu = header?.querySelector(".mobile-menu");
  if (!menu) return;
  const toggle = menu.querySelector("summary");
  const mobile = matchMedia("(max-width: 900px)");
  const desktop = header.querySelector(".desktop-nav");

  function close(restoreFocus = false) {
    if (!menu.open) return;
    menu.open = false;
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  document.addEventListener("click", (event) => {
    if (!header.contains(event.target))
      close(menu.contains(document.activeElement));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open) return;
    event.preventDefault();
    close(true);
  });
  header.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (
      !link ||
      !menu.open ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    close();
    if (link.getAttribute("href").startsWith("#")) {
      const target = document.getElementById(link.hash.slice(1));
      if (target) {
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
          target.addEventListener(
            "blur",
            () => target.removeAttribute("tabindex"),
            { once: true },
          );
        }
        target.focus({ preventScroll: true });
      }
    }
  });
  header.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !header.contains(event.relatedTarget)) close();
    // Hidden links may lose focus before the media-query change event.
    const hiddenNavigation = mobile.matches ? desktop : menu;
    if (!event.relatedTarget && hiddenNavigation.contains(event.target))
      queueMicrotask(() => adaptNavigation(event.target));
  });

  function adaptNavigation(focused) {
    const hiddenNavigation = mobile.matches ? desktop : menu;
    const restoreFocus = hiddenNavigation.contains(focused);
    const destination = [...desktop.querySelectorAll("a")].find(
      (link) => link.getAttribute("href") === focused.getAttribute("href"),
    );
    if (!mobile.matches) close();
    if (restoreFocus)
      (mobile.matches
        ? toggle
        : destination || header.querySelector(".wordmark")
      ).focus({ preventScroll: true });
  }
  mobile.addEventListener("change", () =>
    adaptNavigation(document.activeElement),
  );
})();
