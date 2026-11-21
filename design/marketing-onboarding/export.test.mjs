import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("a reserved name and proof paths inside the pack are refused before rendering", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-onboarding-paths-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "pack");
  await symlink(join(directory, "unused"), output, "dir");
  const options = { date: "2026-11-04", output };
  await assert.rejects(exportPack(options), /Output already exists/);
  await rm(output);
  const parentAlias = join(directory, "alias");
  await symlink(directory, parentAlias, "dir");
  await assert.rejects(
    exportPack({ ...options, proofs: join(parentAlias, "pack", "proofs") }),
    /outside the pack destination/,
  );
  const file = join(directory, "existing.txt");
  await writeFile(file, "keep");
  await assert.rejects(
    exportPack({ ...options, proofs: file }),
    /Proof destination must be a directory/,
  );
  assert.equal(await readFile(file, "utf8"), "keep");
  assert.deepEqual((await readdir(directory)).sort(), [
    "alias",
    "existing.txt",
  ]);
});

function runHelper(operation, request, descriptors) {
  const script = fileURLToPath(new URL("./install-export.py", import.meta.url));
  return execFileSync(
    "/usr/bin/python3",
    [
      "-IB",
      "-c",
      `import json, runpy, sys
helper = runpy.run_path(sys.argv[1])
request = json.load(sys.stdin)
helper['report'](lambda: exec(sys.argv[2], {**helper, 'request': request}))`,
      script,
      operation,
    ],
    {
      input: JSON.stringify(request),
      stdio: ["pipe", "pipe", "pipe", ...descriptors],
      encoding: "utf8",
    },
  );
}

test("staging creation and cleanup stay under the opened parent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-export-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "destination");
  const moved = join(root, "original");
  await mkdir(parent);
  const directory = await open(parent, "r");
  t.after(() => directory.close());
  await rename(parent, moved);
  await mkdir(parent);
  await writeFile(join(parent, "keep.txt"), "existing");

  const name = JSON.parse(
    runHelper("name, _ = create_staging(3)\nprint(json.dumps(name))", null, [
      directory.fd,
    ]),
  );
  assert.deepEqual(await readdir(parent), ["keep.txt"]);
  assert.deepEqual(await readdir(moved), [name]);
  const staged = join(moved, name);
  await mkdir(join(staged, "rendered"));
  await writeFile(join(staged, "rendered", "document.pdf"), "rendered");
  const rendered = await open(staged, "r");
  t.after(() => rendered.close());
  assert.equal(
    runHelper("discard_staging(3, request, 4)", name, [
      directory.fd,
      rendered.fd,
    ]),
    "",
  );
  assert.deepEqual(await readdir(moved), []);
  assert.equal(await readFile(join(parent, "keep.txt"), "utf8"), "existing");
});

test("cleanup leaves a replacement staging entry and its contents untouched", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-export-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = await open(root, "r");
  t.after(() => directory.close());
  const staging = join(root, "staging");
  await mkdir(staging, { mode: 0o700 });
  await writeFile(join(staging, "rendered.pdf"), "rendered");
  const rendered = await open(staging, "r");
  t.after(() => rendered.close());
  await rename(staging, join(root, "original"));
  await mkdir(staging);
  await writeFile(join(staging, "keep.txt"), "existing");
  await symlink(staging, join(root, "original", "alias"), "dir");

  assert.equal(
    runHelper("discard_staging(3, request, 4)", "staging", [
      directory.fd,
      rendered.fd,
    ]),
    "",
  );
  assert.deepEqual(await readdir(join(root, "original")), []);
  assert.deepEqual(await readdir(staging), ["keep.txt"]);
  assert.equal(await readFile(join(staging, "keep.txt"), "utf8"), "existing");
});

test("installation leaves a replacement staging directory untouched", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-export-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "destination");
  const staging = join(parent, "staging");
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const rendered = await open(staging, "r");
  t.after(() => rendered.close());
  const request = {
    staging: "staging",
    output: "pack",
    proofParts: null,
  };
  await rename(staging, join(parent, "original"));
  await mkdir(staging);
  const directory = await open(parent, "r");
  try {
    const result = runHelper("install(request, 3, 4, 5)", request, [
      directory.fd,
      rendered.fd,
    ]);
    assert.match(JSON.parse(result).message, /directory changed/);
    assert.deepEqual((await readdir(parent)).sort(), ["original", "staging"]);
  } finally {
    await directory.close();
  }
});

test("installation does not adopt a newly created proof directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "situate-export-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const staging = join(root, "staging");
  await mkdir(staging, { mode: 0o700 });
  await mkdir(join(staging, ".proofs"));
  await writeFile(join(staging, ".proofs", "page.png"), "new proof");
  const review = join(root, "review");
  await mkdir(review);
  const proofs = join(review, "proofs");
  await mkdir(proofs);
  await writeFile(join(proofs, "keep.txt"), "existing");
  const descriptors = [];
  for (const path of [root, staging, review]) {
    const directory = await open(path, "r");
    t.after(() => directory.close());
    descriptors.push(directory.fd);
  }
  const result = runHelper(
    "install(request, 3, 4, 5)",
    {
      staging: "staging",
      output: "pack",
      proofParts: ["proofs"],
    },
    descriptors,
  );
  assert.equal(JSON.parse(result).code, "EEXIST");
  assert.deepEqual((await readdir(root)).sort(), ["review", "staging"]);
  assert.deepEqual(await readdir(proofs), ["keep.txt"]);
  assert.equal(await readFile(join(proofs, "keep.txt"), "utf8"), "existing");
});

test(
  "pack installation and proof rollback with Chromium",
  {
    skip: process.env.MARKETING_EXPORT_BROWSER_TEST !== "1",
    timeout: 60_000,
  },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "situate-onboarding-browser-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const alias = join(directory, "alias");
    await symlink(directory, alias, "dir");
    const proofs = join(directory, "proofs");
    const output = join(alias, "pack");
    await mkdir(proofs);
    const existing = join(proofs, "03-audience-problems-and-positioning-1.png");
    await writeFile(existing, "existing proof");
    const options = { date: "2026-11-04", output, proofs };

    await assert.rejects(exportPack(options), { code: "EEXIST" });
    assert.deepEqual(await readdir(proofs), [
      "03-audience-problems-and-positioning-1.png",
    ]);
    assert.equal(await readFile(existing, "utf8"), "existing proof");
    assert.deepEqual((await readdir(directory)).sort(), ["alias", "proofs"]);
    const review = await mkdtemp(join(tmpdir(), "situate-onboarding-review-"));
    t.after(() => rm(review, { recursive: true, force: true }));
    const reviewAlias = join(directory, "review");
    await symlink(review, reviewAlias, "dir");
    await exportPack({ ...options, proofs: join(reviewAlias, "proofs") });
    const pack = join(directory, "pack");
    assert.deepEqual((await readdir(pack)).sort(), [
      ...documents,
      "editable-sources",
    ]);
    assert.equal((await readdir(join(review, "proofs"))).length, 12);
    assert.equal(await readFile(existing, "utf8"), "existing proof");
    const pdf = join(
      pack,
      productIntroduction.id,
      "02-product-introduction-2026-11-04.pdf",
    );
    assert.deepEqual(
      await readFile(pdf),
      await readFile(
        new URL(`../../${productIntroduction.pdf}`, import.meta.url),
      ),
    );
  },
);
