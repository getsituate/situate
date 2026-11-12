export function installLocalizationAudit({ catalog, mode = "keys" }) {
  globalThis.__SITUATE_LOCALIZATION_KEYS__ = mode === "keys";
  if (mode !== "keys") return;
  const attributes = [
    "aria-label",
    "aria-description",
    "placeholder",
    "title",
    "alt",
  ];
  const domains = new Set(["user", "external", "formatted", "identity"]);
  const seen = new Set();
  const pending = new Set();
  const removed = new Set();
  let timer;
  const renderer =
    'article.markdown[data-localization-content="user"], .chat-markdown[data-localization-content="external"]';

  function valid(value) {
    let rest = value.trim();
    while (rest) {
      const punctuation = rest.match(/^[\s\p{P}\p{S}]+/u)?.[0] ?? "";
      // The marker brackets are symbols too; never consume them as punctuation.
      const beforeMarker = punctuation.split("⟦")[0].split("⟧")[0];
      rest = rest.slice(beforeMarker.length);
      if (!rest) return true;
      const head = rest.match(/^⟦([A-Za-z0-9_.-]+)([:⟧])/u);
      if (!head || !Object.hasOwn(catalog, head[1])) return false;
      const expected = [
        ...new Set(
          [...catalog[head[1]].matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(
            (match) => match[1],
          ),
        ),
      ].sort();
      let end = head[0].length;
      if (head[2] === ":") {
        let params;
        let found = false;
        for (
          let index = rest.indexOf("⟧", end);
          index !== -1;
          index = rest.indexOf("⟧", index + 1)
        ) {
          try {
            params = JSON.parse(rest.slice(end, index));
          } catch {
            continue;
          }
          end = index + 1;
          found = true;
          break;
        }
        if (
          !found ||
          !params ||
          Array.isArray(params) ||
          typeof params !== "object"
        )
          return false;
        if (
          JSON.stringify(Object.keys(params).sort()) !==
          JSON.stringify(expected)
        )
          return false;
        if (
          Object.values(params).some(
            (value) => typeof value !== "string" && typeof value !== "number",
          )
        )
          return false;
      } else if (expected.length) return false;
      rest = rest.slice(end);
    }
    return true;
  }

  function report(element, kind, value) {
    const violation = {
      url: location.href,
      element: element.localName,
      kind,
      value,
    };
    const id = JSON.stringify(violation);
    if (seen.has(id)) return;
    seen.add(id);
    const delivery = globalThis.__situateReportLocalization(violation);
    pending.add(delivery);
    delivery.finally(() => pending.delete(delivery));
  }

  function scan(root) {
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script,style,template,noscript")) return;
        if (parent.closest(renderer)) return;
        const domain = parent.getAttribute("data-localization-content");
        if (domains.has(domain) && parent.children.length === 0) return;
        const group = parent.closest("[data-localization-text-group]");
        const text = (group ?? node).textContent;
        if (!valid(text ?? "")) report(group ?? parent, "text", text);
        return;
      }
      if (
        node.nodeType !== Node.ELEMENT_NODE &&
        node.nodeType !== Node.DOCUMENT_NODE &&
        node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
      )
        return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches("script,style,template,noscript")) return;
        const boundary = node.closest(renderer);
        if (boundary && boundary !== node) return;
        const domain = node.getAttribute("data-localization-content");
        if (
          domain !== null &&
          (!domains.has(domain) ||
            (node.children.length && !node.matches(renderer)))
        ) {
          report(node, "content-boundary", domain);
        }
        for (const attribute of attributes) {
          const value = node.getAttribute(attribute);
          if (value && !valid(value)) report(node, attribute, value);
        }
        if (node.shadowRoot) visit(node.shadowRoot);
      }
      for (const child of node.childNodes) visit(child);
    };
    visit(root);
  }

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    scan(document);
    for (const node of removed) scan(node);
    removed.clear();
  }
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.removedNodes) removed.add(node);
    // A task boundary lets Vue finish its microtask-based patch before inspecting labels.
    if (timer === undefined) timer = setTimeout(flush, 0);
  });
  const observeDocument = () =>
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        ...attributes,
        "data-localization-content",
        "data-localization-text-group",
      ],
    });
  observeDocument();
  globalThis.__situateFlushLocalization = async () => {
    await Promise.resolve();
    flush();
    await Promise.all([...pending]);
  };
  addEventListener("pagehide", flush);
  addEventListener("DOMContentLoaded", () => {
    observeDocument();
    flush();
  });
  if (document.readyState !== "loading") flush();
}
