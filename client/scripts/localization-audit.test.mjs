import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installLocalizationAudit } from "./localization-audit.mjs";

function browser(t, mode = "keys") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://app.invalid/",
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const violations = [];
  dom.window.__situateReportLocalization = async (violation) => {
    violations.push(violation);
  };
  dom.window.eval(
    `(${installLocalizationAudit.toString()})(${JSON.stringify({ mode, catalog: { "app.title": "Title", "app.hello": "Hello {name}" } })})`,
  );
  return {
    window: dom.window,
    document: dom.window.document,
    violations,
    flush: () => dom.window.__situateFlushLocalization?.(),
  };
}

test("known whole markers and correctly named JSON parameters pass", async (t) => {
  const { document, violations, flush, window } = browser(t);
  assert.equal(window.__SITUATE_LOCALIZATION_KEYS__, true);
  document.body.innerHTML =
    '<p> (⟦app.title⟧) · ⟦app.hello:{"name":"A ⟧ person"}⟧! </p>';
  await flush();
  assert.deepEqual(violations, []);
});

test("animated text groups validate their complete text and descendant labels", async (t) => {
  const { document, violations, flush } = browser(t);
  document.body.innerHTML =
    "<span data-localization-text-group><span>⟦app.</span><span>title⟧</span></span>";
  await flush();
  assert.deepEqual(violations, []);
  document
    .querySelector("span span")
    .setAttribute("title", "Untranslated label");
  document.querySelector("span span").textContent = "Unknown";
  await flush();
  assert.ok(violations.some((entry) => entry.kind === "title"));
  assert.ok(
    violations.some(
      (entry) => entry.kind === "text" && entry.value === "Unknowntitle⟧",
    ),
  );
});

test("marker prefixes, unknown keys, unmarked suffixes, and invalid parameters fail", async (t) => {
  const { document, violations, flush } = browser(t);
  const bad = [
    "⟦missing⟧",
    "⟦app.title⟧ English",
    "⟦app.title",
    '⟦app.title:{"extra":1}⟧',
    "⟦app.hello⟧",
    '⟦app.hello:{"wrong":"x"}⟧',
    '⟦app.hello:{"name":{}}⟧',
    "42",
  ];
  for (const value of bad) {
    const element = document.createElement("p");
    element.textContent = value;
    document.body.append(element);
  }
  await flush();
  assert.deepEqual(
    violations.map((entry) => entry.value),
    bad,
  );
});

test("each user-facing attribute is audited even on annotated leaves", async (t) => {
  const { document, violations, flush } = browser(t);
  const attributes = [
    "aria-label",
    "aria-description",
    "placeholder",
    "title",
    "alt",
  ];
  const element = document.createElement("span");
  element.dataset.localizationContent = "user";
  element.textContent = "Personal document";
  for (const attribute of attributes)
    element.setAttribute(attribute, "Untranslated label");
  document.body.append(element);
  await flush();
  assert.deepEqual(
    violations.map((entry) => entry.kind),
    attributes,
  );
});

test("leaf domains do not exempt nested product UI", async (t) => {
  const { document, violations, flush } = browser(t);
  document.body.innerHTML =
    '<span data-localization-content="formatted">42</span><span data-localization-content="identity">Situate</span><span data-localization-content="external">Provider name</span><div data-localization-content="user"><button>Delete</button></div>';
  await flush();
  assert.deepEqual(
    violations.map((entry) => entry.kind),
    ["content-boundary", "text"],
  );
  assert.equal(violations[1].value, "Delete");
});

test("the document renderer owns descendant content but not its own label", async (t) => {
  const { document, violations, flush } = browser(t);
  document.body.innerHTML =
    '<article class="markdown" data-localization-content="user" aria-label="Document"><h1>My notes</h1><img alt="My photo"><a title="My link">Link</a></article>';
  await flush();
  assert.deepEqual(
    violations.map((entry) => [entry.kind, entry.value]),
    [["aria-label", "Document"]],
  );
});

test("chat Markdown owns model content but not surrounding controls", async (t) => {
  const { document, violations, flush } = browser(t);
  document.body.innerHTML =
    '<div class="chat-markdown" data-localization-content="external"><p><strong>Model response</strong></p><a title="Reference">Read more</a><pre><code>example()</code></pre></div><button>Untranslated action</button>';
  await flush();
  assert.deepEqual(
    violations.map((entry) => [entry.kind, entry.value]),
    [["text", "Untranslated action"]],
  );
});

test("removed dialogs are retained and delivery is awaited", async (t) => {
  const { document, violations, flush, window } = browser(t);
  const dialog = document.createElement("dialog");
  dialog.textContent = "Untranslated dialog";
  document.body.append(dialog);
  dialog.remove();
  await new Promise((resolve) => {
    window.queueMicrotask(resolve);
  });
  await flush();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].value, "Untranslated dialog");
  document.body.replaceChildren();
  await flush();
  assert.equal(violations.length, 1);
});

test("framework microtask patches settle before audit", async (t) => {
  const { document, violations, window, flush } = browser(t);
  await new Promise((resolve) => {
    window.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
  const button = document.createElement("button");
  button.textContent = "Transient";
  document.body.append(button);
  window.queueMicrotask(() => {
    button.textContent = "⟦app.title⟧";
  });
  await new Promise((resolve) => {
    window.setTimeout(resolve, 10);
  });
  await flush();
  assert.deepEqual(violations, []);
});

test("real-language mode disables marker validation and key rendering", async (t) => {
  const { document, window, violations, flush } = browser(t, "real");
  document.body.innerHTML = "<p>Translated English</p>";
  await flush();
  assert.equal(window.__SITUATE_LOCALIZATION_KEYS__, false);
  assert.deepEqual(violations, []);
});
