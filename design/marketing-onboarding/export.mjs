import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { marked } from "marked";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sources = join(root, "docs/marketing/onboarding");
const require = createRequire(import.meta.url);

export const documents = [
  "01-welcome-to-situate",
  "02-product-introduction",
  "03-audience-problems-and-positioning",
  "04-brand-voice-and-writing-examples",
  "05-content-and-community-playbook",
  "06-brand-assets-and-examples",
];

export const productIntroduction = {
  id: "02-product-introduction",
  pdf: "docs/marketing/onboarding/02-product-introduction.pdf",
};

const allowedLinks = new Set([
  "https://reboot.getsituate.com/",
  "https://reboot.getsituate.com/#story",
]);

export const artwork = [
  [
    "wordmark",
    "design/brand/assets/wordmark.svg",
    "Wordmark on light backgrounds",
  ],
  [
    "wordmark-light",
    "design/brand/assets/wordmark-light.svg",
    "Wordmark on plum",
    "dark",
  ],
  ["app-icon", "design/brand/assets/app-icon.svg", "Square identity artwork"],
  [
    "bend-wave-welcome",
    "design/brand/bend/svg/wave-welcome.svg",
    "A welcoming gesture",
  ],
  [
    "bend-rest-welcome",
    "design/brand/bend/svg/rest-welcome.svg",
    "Quiet supporting presence",
  ],
  [
    "bend-read-thinking",
    "design/brand/bend/svg/read-thinking.svg",
    "Reading and considering",
  ],
  [
    "mini-bend",
    "design/brand/bend/mini/mini.svg",
    "Compact mark on light backgrounds",
  ],
  [
    "mini-bend-light",
    "design/brand/bend/mini/mini-light.svg",
    "Compact mark on plum",
    "dark",
  ],
  [
    "linked-notes",
    "design/brand/assets/linked-notes.svg",
    "Connecting information",
  ],
  [
    "collection-folder",
    "design/brand/assets/collection-folder.svg",
    "Keeping related material together",
  ],
  [
    "desk-calendar",
    "design/brand/assets/desk-calendar.svg",
    "Planning a personal moment",
  ],
  [
    "gathering",
    "design/brand/assets/gathering.svg",
    "Paper-and-ribbon composition",
  ],
];
export const previews = [
  ["notes", "website/media/notes.webp", "Birthday notes and tasks"],
  ["workspace", "website/media/workspace.webp", "Context beside a request"],
  [
    "conversation",
    "website/media/conversation.webp",
    "A simulated prepared reply",
  ],
];
const paletteNames = [
  "paper",
  "surface",
  "ink",
  "muted",
  "violet-deep",
  "violet",
  "sky",
  "tangerine",
];

export function validateDate(value) {
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}$/,
    "Use YYYY-MM-DD for the extraction date.",
  );
  const date = new Date(`${value}T00:00:00Z`);
  assert.ok(
    Number.isFinite(date.valueOf()) && date.toISOString().startsWith(value),
    "Invalid extraction date.",
  );
  return value;
}

function escape(value) {
  return String(value).replace(
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

export function splitPages(source) {
  const pages = source
    .trim()
    .split(/\n---\n/)
    .map((page) => page.trim());
  for (const page of pages) {
    assert.match(page, /^# [^\n]+\n/, "Each page needs a title.");
    const tokens = marked.lexer(page);
    marked.walkTokens(tokens, (token) => {
      assert.ok(
        !["html", "image"].includes(token.type),
        "Sources must be self-contained prose, without HTML or images.",
      );
      if (token.type === "link")
        assert.ok(
          allowedLinks.has(token.href),
          "Only approved public website links are allowed.",
        );
    });
    assert.equal(
      tokens.filter((token) => token.type === "heading" && token.depth === 1)
        .length,
      1,
    );
  }
  return pages;
}

const assetFilename = (name, date, extension) => `${name}-${date}.${extension}`;

async function dataUrl(path) {
  const bytes = await readFile(join(root, path));
  const mime = path.endsWith(".svg") ? "image/svg+xml" : "image/webp";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export async function prepare(date) {
  validateDate(date);
  const tokens = JSON.parse(
    await readFile(join(root, "design/brand/tokens.json"), "utf8"),
  );
  const css = await readFile(new URL("print.css", import.meta.url), "utf8");
  const variables = Object.entries(tokens.colors)
    .map(([key, value]) => `--situate-${key}:${value};`)
    .join("");
  const wordmark = await dataUrl(artwork[0][1]);
  const gallery = async (entries, kind, extension) =>
    `<div class="gallery ${kind}">${(await Promise.all(entries.map(async ([name, path, description, background]) => `<figure><div class="art ${background || ""}"><img src="${await dataUrl(path)}" alt="${escape(description)}"></div><figcaption><strong>${escape(name)}</strong><br>${escape(description)}</figcaption></figure>`))).join("")}</div><p class="asset-caption">File pattern: name-${date}.${extension}</p>`;
  const expansions = {
    palette: `<div class="palette">${paletteNames.map((name) => `<div><span style="background:${tokens.colors[name]}"></span><strong>${name}</strong><br>${tokens.colors[name]}</div>`).join("")}</div>`,
    "artwork-gallery": await gallery(artwork, "artwork", "svg / png"),
    "preview-gallery": await gallery(previews, "previews", "webp / png"),
  };
  const editableExpansions = {
    palette: paletteNames
      .map((name) => `- ${name}: ${tokens.colors[name]}`)
      .join("\n"),
    "artwork-gallery": artwork
      .map(
        ([name, , description]) =>
          `- ${description}: ${assetFilename(name, date, "svg")} and ${assetFilename(name, date, "png")}`,
      )
      .join("\n"),
    "preview-gallery": previews
      .map(
        ([name, , description]) =>
          `- ${description}: ${assetFilename(name, date, "webp")} and ${assetFilename(name, date, "png")}`,
      )
      .join("\n"),
  };
  const result = [];
  for (const [index, id] of documents.entries()) {
    const source = await readFile(join(sources, `${id}.md`), "utf8");
    const title = source.split("\n")[0].slice(2);
    assert.ok(
      id.startsWith(`${String(index + 1).padStart(2, "0")}-`) &&
        source.startsWith(`# ${index + 1}. `),
      "Document filenames and titles must follow the same consecutive order.",
    );
    if (id === productIntroduction.id) {
      const pdfSource = join(root, productIntroduction.pdf);
      const pdf = await readFile(pdfSource);
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      result.push({
        id,
        title,
        editable: source,
        pdfSource,
      });
      continue;
    }
    const pages = splitPages(source);
    let body = pages
      .map((page, index) => {
        let content = marked.parse(page);
        for (const [key, html] of Object.entries(expansions))
          content = content.replace(`<p>{{${key}}}</p>`, html);
        assert.ok(!content.includes("{{"), "Unresolved document placeholder.");
        return `<section class="sheet"><header><img src="${wordmark}" alt="Situate"><span>Marketing &amp; social media</span></header><main class="page-content">${content}</main><footer><span>${escape(title)}</span><span>${index + 1} / ${pages.length}</span></footer></section>`;
      })
      .join("\n");
    body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>:root{${variables}}\n${css}</style></head><body>${body}</body></html>`;
    let editable = source;
    for (const [key, text] of Object.entries(editableExpansions))
      editable = editable.replace(`{{${key}}}`, text);
    result.push({ id, title, html: body, editable, pages: pages.length });
  }
  return result;
}

export async function exportPack({ date, output, proofs }) {
  const prepared = await prepare(date);
  output = resolve(output);
  await assert.rejects(
    access(output),
    { code: "ENOENT" },
    "Output already exists; choose a new empty destination.",
  );
  const staging = await mkdtemp(join(dirname(output), ".situate-onboarding-"));
  let browser;
  let reserved = false;
  try {
    const { chromium } = require("../../client/node_modules/playwright");
    const { launchBrowser } = require("../brand/browser-launch.cjs");
    browser = await launchBrowser(chromium, { headless: true });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      deviceScaleFactor: 1,
    });
    const unexpectedRequests = [];
    await context.route("**/*", (route) => {
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
    if (proofs) await mkdir(proofs, { recursive: true });
    const editableDirectory = join(staging, "editable-sources");
    await mkdir(editableDirectory);
    for (const document of prepared) {
      const directory = join(staging, document.id);
      await mkdir(directory);
      const filename = `${document.id}-${date}`;
      await writeFile(
        join(editableDirectory, `${filename}.md`),
        document.editable,
      );
      if (document.pdfSource) {
        await copyFile(document.pdfSource, join(directory, `${filename}.pdf`));
        console.log(`${document.id}: preserved product introduction PDF`);
        continue;
      }
      await page.setContent(document.html, { waitUntil: "load" });
      const layout = await page.locator(".sheet").evaluateAll((sheets) =>
        sheets.map((sheet) => {
          const content = sheet.querySelector(".page-content");
          const bounds = content.getBoundingClientRect();
          return {
            overflow:
              content.scrollHeight > content.clientHeight + 1 ||
              content.scrollWidth > content.clientWidth + 1,
            outside: [...content.querySelectorAll("*")].some((element) => {
              const box = element.getBoundingClientRect();
              return (
                box.bottom > bounds.bottom + 1 ||
                box.right > bounds.right + 1 ||
                box.left < bounds.left - 1
              );
            }),
            brokenImages: [...sheet.querySelectorAll("img")].some(
              (image) => !image.complete || image.naturalWidth === 0,
            ),
          };
        }),
      );
      assert.deepEqual(
        layout,
        Array.from({ length: document.pages }, () => ({
          overflow: false,
          outside: false,
          brokenImages: false,
        })),
        `Page layout overflow or missing image: ${document.id}`,
      );
      await page.pdf({
        path: join(directory, `${filename}.pdf`),
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        tagged: true,
        outline: true,
      });
      if (proofs) {
        for (let index = 0; index < document.pages; index++)
          await page
            .locator(".sheet")
            .nth(index)
            .screenshot({
              path: join(proofs, `${document.id}-${index + 1}.png`),
            });
      }
      console.log(`${document.id}: ${document.pages} pages`);
    }
    const assetRoot = join(staging, documents.at(-1));
    for (const [folder, entries, extension] of [
      ["brand-artwork", artwork, "svg"],
      ["illustrative-interface-previews", previews, "webp"],
    ]) {
      const directory = join(assetRoot, folder);
      await mkdir(directory);
      for (const [name, source] of entries) {
        await copyFile(
          join(root, source),
          join(directory, assetFilename(name, date, extension)),
        );
        const image = await dataUrl(source);
        await page.setContent(
          `<html><body style="margin:0;background:transparent"><img src="${image}" alt=""></body></html>`,
          { waitUntil: "load" },
        );
        const dimensions = await page.locator("img").evaluate((element) => {
          const width = element.naturalWidth;
          const height = element.naturalHeight;
          if (!width || !height) throw new Error("Image has no dimensions.");
          return { width, height };
        });
        const width =
          extension === "svg"
            ? name.includes("wordmark")
              ? 1650
              : 1200
            : dimensions.width;
        const height = Math.round(
          (width * dimensions.height) / dimensions.width,
        );
        await page.setViewportSize({ width, height });
        await page.locator("img").evaluate(
          (element, size) => {
            element.style.cssText = `display:block;width:${size.width}px;height:${size.height}px;`;
          },
          { width, height },
        );
        await page.screenshot({
          path: join(directory, assetFilename(name, date, "png")),
          omitBackground: true,
        });
      }
    }
    const notice = `Situate asset origins and reuse\n\nThe wordmark, Bend, Mini Bend and paper-and-ribbon illustrations are original artwork by Situate contributors, licensed under Creative Commons Attribution 4.0 International (CC BY 4.0). Commercial reuse and modifications are permitted. Credit Situate contributors, link to the source and license, indicate changes and retain supplied notices as required by the license. The supplied PNG artwork files are format conversions of the SVG originals. Source: https://github.com/getsituate/situate (design/brand/). License: https://creativecommons.org/licenses/by/4.0/. The full legal text follows below. No font files are distributed as assets.\n\nTrademark rights are separate. Artistic reuse outside Situate is permitted, but do not imply official affiliation or use the artwork as misleading product or service branding. Policy: https://github.com/getsituate/situate/blob/main/TRADEMARKS.md\n\nInterface images are synthetic design-workshop captures, not evidence of shipped features, real accounts, live AI execution or native platform qualification. The supplied WebP images are unchanged; PNG files are browser-rendered format conversions.\n\nProvider marks belong to their respective owners; no endorsement is implied. Provider icons in the captures retain the following notice:\n\n${await readFile(join(root, "website/media/provider-icons-license.txt"), "utf8")}\n\nOriginal Situate artwork license:\n\n${await readFile(join(root, "LICENSES/CC-BY-4.0.txt"), "utf8")}`;
    await writeFile(join(assetRoot, `asset-notices-${date}.txt`), notice);
    assert.deepEqual(
      unexpectedRequests,
      [],
      "Export attempted network access.",
    );
    await browser.close();
    browser = undefined;
    // Reserve the destination exclusively. Never replace a pre-existing pack or user folder.
    await mkdir(output);
    reserved = true;
    await rename(staging, output);
    console.log(`Created ${output}`);
  } catch (error) {
    if (reserved) await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    await browser?.close();
    await rm(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      date: { type: "string" },
      output: { type: "string" },
      proofs: { type: "string" },
    },
  });
  assert.ok(
    values.date && values.output,
    "Usage: node design/marketing-onboarding/export.mjs --date YYYY-MM-DD --output /path/to/new-pack [--proofs /path/to/review-images]",
  );
  await exportPack(values);
}
