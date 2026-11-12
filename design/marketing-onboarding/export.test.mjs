import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  artwork,
  documents,
  exportPack,
  prepare,
  previews,
  productIntroduction,
  splitPages,
  validateDate,
} from "./export.mjs";

test("dates are explicit calendar dates, not paths or normalized invalid dates", () => {
  assert.equal(validateDate("2026-11-04"), "2026-11-04");
  assert.equal(validateDate("2028-02-29"), "2028-02-29");
  for (const date of [
    "2026-02-29",
    "2026-13-01",
    "2026-11-31",
    "../2026-11-04",
    "2026-1-4",
  ])
    assert.throws(() => validateDate(date));
});

test("page sources stay self-contained and cannot inject HTML or load resources", () => {
  assert.equal(
    splitPages("# First\n\nText.\n\n---\n\n# Second\n\nMore.").length,
    2,
  );
  for (const source of [
    "No title",
    "# Title\n\n<script>alert(1)</script>",
    "# Title\n\n[Source](../private.md)",
    "# Title\n\n[Source](file:///private/document.md)",
    "# Title\n\n[Source](javascript:alert%281%29)",
    "# Title\n\n[Source](https://example.com/)",
    "# Title\n\n[Source](https://reboot.getsituate.com/?private=value)",
    "# Title\n\n[Source](https://user:password@reboot.getsituate.com/)",
    "# Title\n\n[Source](https://reboot.getsituate.com.evil.example/)",
    "# Title\n\n![Photo](https://example.com/photo.png)",
    "# One\n\n# Two\n",
  ])
    assert.throws(() => splitPages(source));
});

test("approved website links remain clickable without allowing arbitrary resources", () => {
  for (const link of [
    "https://reboot.getsituate.com/",
    "https://reboot.getsituate.com/#story",
  ])
    assert.equal(splitPages(`# Title\n\n[Website](${link})`).length, 1);
});

test("the pack contains only the requested documents with resolved, repository-independent content", async () => {
  assert.deepEqual(
    documents.map((id) => id.slice(0, 2)),
    ["01", "02", "03", "04", "05", "06"],
  );
  const sourceFiles = await readdir(
    new URL("../../docs/marketing/onboarding/", import.meta.url),
  );
  assert.deepEqual(
    sourceFiles
      .filter((file) => file.endsWith(".md") && file !== "README.md")
      .sort(),
    documents.map((id) => `${id}.md`),
  );
  const pack = await prepare("2026-11-04");
  const rendered = pack.filter((document) => !document.pdfSource);
  assert.deepEqual(
    rendered.map((document) => document.pages),
    [1, 3, 2, 3, 3],
  );
  assert.deepEqual(
    pack.map((document) => Number(document.title.split(".")[0])),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    [...pack[0].editable.matchAll(/^(\d)\. \*\*/gm)].map((match) =>
      Number(match[1]),
    ),
    [1, 2, 3, 4, 5, 6],
  );
  for (const document of rendered) {
    assert.equal(
      (document.html.match(/class="sheet"/g) || []).length,
      document.pages,
    );
    assert.match(document.html, /<html lang="en">/);
    assert.match(document.html, /data:image\/svg\+xml;base64,/);
    assert.doesNotMatch(
      document.html,
      /\{\{|src="(?:https?:|file:|\/)|href="(?:file:|\/)|<script|<iframe/,
    );
    assert.doesNotMatch(
      document.editable,
      /\{\{|\/Volumes\/|\/Users\/|\.\.\/|^(?:Owner|Status|Last updated):/m,
    );
  }
  assert.deepEqual(
    [
      ...pack.flatMap((document) => [
        ...(document.html || "").matchAll(/href="([^"]+)"/g),
      ]),
    ].map((match) => match[1]),
    ["https://reboot.getsituate.com/#story"],
  );
  assert.match(pack[2].editable, /\*\*Automation:\*\*/);
  assert.match(pack[2].editable, /Inbox Zero/);
  assert.match(pack[2].editable, /preparation and follow-up blocks/);
  assert.match(pack[2].editable, /Replies prepared automatically/);
  assert.doesNotMatch(
    pack[0].editable,
    /Each topic has a PDF|editable-sources/,
  );
  assert.match(
    pack[4].editable,
    /When did this last happen, and how did you deal with it/,
  );
  assert.match(pack.at(-1).editable, /wordmark-2026-11-04\.svg/);
  assert.match(pack.at(-1).editable, /notes-2026-11-04\.png/);
  for (const [, source] of [...artwork, ...previews])
    await readFile(new URL(`../../${source}`, import.meta.url));
});

test("the product introduction has one numbered source and its matching PDF", async () => {
  const pack = await prepare("2026-11-04");
  const product = pack[1];
  assert.equal(product.id, "02-product-introduction");
  assert.equal(
    productIntroduction.pdf,
    "docs/marketing/onboarding/02-product-introduction.pdf",
  );
  assert.equal(
    product.editable,
    await readFile(
      new URL(
        "../../docs/marketing/onboarding/02-product-introduction.md",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    await readFile(product.pdfSource),
    await readFile(
      new URL(`../../${productIntroduction.pdf}`, import.meta.url),
    ),
  );
  assert.equal(product.html, undefined);
  assert.match(product.editable, /Marcus and Nils share a conviction:/);
  assert.doesNotMatch(product.editable, /Nils and Markus/);
  assert.match(product.editable, /## 8\. Current development stage/);
  assert.match(product.editable, /### 8\.2 Available prototype/);
  assert.match(product.editable, /^# 2\. Situate: a product introduction/);
  assert.match(pack[0].editable, /\*\*02-product-introduction\*\*/);
});

test("an existing destination is refused before launching a browser or changing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-onboarding-test-"));
  try {
    const sentinel = join(directory, "keep.txt");
    await writeFile(sentinel, "unrelated material");
    await assert.rejects(
      exportPack({ date: "2026-11-04", output: directory }),
      /Output already exists/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "unrelated material");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
