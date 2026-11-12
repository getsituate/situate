import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const root = "../../src/ai/browser-callback/";
const template = read(`${root}page.html`);
const style = `${read("../../../../design/brand/tokens.css")}\n${read(`${root}page.css`)}`;
const script = [
  read("../../../../design/brand/bend/performance.js"),
  read(`${root}score.js`),
  read(`${root}runtime.js`),
].join("\n");
const image = (path) =>
  `data:image/svg+xml;base64,${Buffer.from(read(path)).toString("base64")}`;
const wordmark = image("../../../../design/brand/assets/wordmark.svg");
const card = image("../../../../design/brand/assets/card.svg");
const bend = read(
  "../../../../design/brand/bend/svg/rest-welcome.svg",
).replaceAll(/ style="[^"]*"/g, "");
const catalogs = Object.fromEntries(
  ["en", "de"].map((language) => [
    language,
    JSON.parse(
      read(
        `../../../packages/localization/src/catalogs/${language}.native.json`,
      ),
    ),
  ]),
);
const hash = (value) => createHash("sha256").update(value).digest("base64");
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function callbackText(language, key) {
  const value = catalogs[language]?.[`native.ai.login.browser.${key}`];
  if (!value) throw new Error("Missing callback translation");
  return value;
}

export function callbackPage({ language = "en", accepted = true } = {}) {
  if (language !== "en" && language !== "de")
    throw new Error("Unsupported callback locale");
  const bindings = {
    language,
    status: accepted ? "received" : "rejected",
    receivedHidden: accepted ? "" : "hidden",
    rejectedHidden: accepted ? "hidden" : "",
    heading: accepted ? "callback-title-received" : "callback-title-rejected",
    styles: `<style>${style}</style>`,
    script: `<script>${script}</script>`,
    wordmark,
    card,
    bend,
  };
  const body = template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, key) => {
    if (Object.hasOwn(bindings, key)) return bindings[key];
    const copy = catalogs[language][key];
    if (!key.startsWith("native.ai.login.browser.") || !copy)
      throw new Error("Unknown callback field");
    return escape(copy);
  });
  return {
    status: accepted ? 200 : 400,
    body,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; style-src-attr 'none'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Length": String(Buffer.byteLength(body)),
    },
  };
}
